import crypto from 'crypto';
import httpStatus from 'http-status';
import { DateTime } from 'luxon';
import { Types } from 'mongoose';
import config from '../../configs/config';
import { getAgenda } from '../../configs/agenda';
import logger from '../../configs/logger';
import { scheduleJob } from '../../jobs/defineJob';
import { JOB_NAMES } from '../../jobs/jobNames';
import {
	Client,
	GbpProfileSnapshot,
	GbpReport,
	IGbpProfileSnapshot,
	IGbpReport,
	ILocation,
	IReport,
	IReportSnapshot,
	LeanRankRun,
	Location,
	LocationCitation,
	RankRun,
	REPORT_SECTIONS,
	Report,
	ReportRangeParam,
	ReportSchedule,
	ReportSnapshot,
	ReportStatus,
	ReportType,
	UserGBP,
} from '../../models';
import { ApiError, apiErrorWithData } from '../../utils';
import { findAccessibleLocation } from '../org/access';
import { OrgContext } from '../org/context';
import { brandingService } from './branding.service';
import { buildDocument } from './blocks';
import { renderPdf } from './render/pdf';
import { buildCitationData } from './sections/citations';
import { buildCompetitorData } from './sections/competitors';
import { buildGbpAuditData } from './sections/gbpAudit';
import { findReportRun, loadRankTrackerData } from './sections/rankTracker';
import { withDefaults } from '../ranking/trackingSettings';
import { reportStorage, ReportStorage } from './storage';
import { PartUnavailable, SnapshotData } from './types';

// Reports center (Phase 12): creating, listing, viewing, downloading and archiving reports, and the
// report-generate job body. A report reads only stored data (rank runs, the GBP report, the profile
// snapshot), freezes it in a ReportSnapshot with the organization's branding, then renders the PDF
// once. One active (queued/generating) report per location and type.

const DUPLICATE_KEY = 11000;
/** An active report older than this is assumed lost (the process died) and is marked failed. */
const STUCK_MS = 30 * 60 * 1000;

type Id = Types.ObjectId | string;

export interface CreateInput {
	location_id: string;
	type: ReportType;
	sections?: string[];
	run_id?: string | null;
	range?: ReportRangeParam;
}

export interface CreateMeta {
	trigger: 'manual' | 'schedule';
	schedule_id?: Id | null;
	created_by: Id;
}

export type Enqueue = (name: string, data: Record<string, string>) => Promise<void>;

const defaultEnqueue: Enqueue = async (name, data) => {
	await scheduleJob(getAgenda(), name, new Date(), data);
};

const off = (reason: string): PartUnavailable => ({ available: false, reason });

/** Sections to use: the requested ones in canonical order, or all of the type's. */
export const resolveSections = (type: ReportType, requested?: string[] | null): string[] => {
	const all = REPORT_SECTIONS[type] as readonly string[];
	if (!requested || requested.length === 0) return [...all];
	const unknown = requested.filter((s) => !all.includes(s));
	if (unknown.length) throw apiErrorWithData(httpStatus.BAD_REQUEST, `Unknown section(s) for ${type}: ${unknown.join(', ')}.`, { reason: 'invalid_section', allowed: all });
	return all.filter((s) => requested.includes(s));
};

/** Report scope filter for a context: the organization, and for a client_user its clients only. */
export const reportScope = (ctx: Pick<OrgContext, 'organization' | 'membership'>): Record<string, unknown> => ({
	organization_id: ctx.organization._id,
	...(ctx.membership.role === 'client_user' ? { client_id: { $in: ctx.membership.client_ids } } : {}),
});

const slug = (s: string): string =>
	s
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 60) || 'report';

export const pdfFilename = (locationName: string, type: ReportType, at: Date): string =>
	`${slug(locationName)}-${type.replace(/_/g, '-')}-${DateTime.fromJSDate(at, { zone: 'utc' }).toFormat('yyyy-LL-dd')}.pdf`;

export interface ReportServiceDeps {
	storage?: ReportStorage;
	enqueue?: Enqueue;
	now?: () => Date;
	freezeBranding?: typeof brandingService.freeze;
}

export const createReportService = (deps: ReportServiceDeps = {}) => {
	const storage = deps.storage ?? reportStorage;
	const enqueue = deps.enqueue ?? defaultEnqueue;
	const now = deps.now ?? (() => new Date());
	const freezeBranding = deps.freezeBranding ?? brandingService.freeze;

	// ---- create ----

	/** Checks the data the type needs exists; returns the rank run to pin (if any). */
	const precheck = async (location: ILocation, type: ReportType, runId: string | null | undefined) => {
		const needsRun = type === 'rank_tracker' || type === 'full' || type === 'competitor_analysis';
		const run = needsRun ? await findReportRun(location._id as Types.ObjectId, runId ?? null) : null;
		if (runId && !run) throw apiErrorWithData(httpStatus.BAD_REQUEST, 'No completed rank run with this id for this location.', { reason: 'no_rank_run' });
		if (type === 'rank_tracker' && !run) throw apiErrorWithData(httpStatus.BAD_REQUEST, 'This location has no completed rank run yet.', { reason: 'no_rank_run' });
		if (type === 'gbp_audit' || type === 'competitor_analysis' || type === 'full') {
			const gbp = await GbpReport.findOne({ location_id: location._id }).select({ competitors: 1 }).lean<Pick<IGbpReport, 'competitors'>>();
			if (type === 'gbp_audit') {
				if (!(await UserGBP.exists({ location_id: location._id, is_active: true }))) {
					throw apiErrorWithData(httpStatus.BAD_REQUEST, 'Connect the Google Business Profile first.', { reason: 'gbp_not_connected' });
				}
				if (!gbp) throw apiErrorWithData(httpStatus.BAD_REQUEST, 'The GBP report has not been generated yet.', { reason: 'no_gbp_report' });
			}
			if (type === 'competitor_analysis') {
				if (!gbp) throw apiErrorWithData(httpStatus.BAD_REQUEST, 'The GBP report has not been generated yet.', { reason: 'no_gbp_report' });
				if (!gbp.competitors?.available) {
					const reason = (gbp.competitors as PartUnavailable | null)?.reason ?? 'no_data';
					throw apiErrorWithData(httpStatus.BAD_REQUEST, 'No competitor comparison for this location yet.', { reason });
				}
			}
			if (type === 'full' && !run && !gbp && !(await LocationCitation.exists({ location_id: location._id, active: true }))) {
				throw apiErrorWithData(httpStatus.BAD_REQUEST, 'This location has no rankings, GBP report or citations yet.', { reason: 'no_data' });
			}
		}
		// Phase 16: a Citation Report needs a citation list.
		if (type === 'citation' && !(await LocationCitation.exists({ location_id: location._id, active: true }))) {
			throw apiErrorWithData(httpStatus.BAD_REQUEST, 'No citations are tracked for this location yet.', { reason: 'no_citations_yet' });
		}
		return run;
	};

	const viewOf = (r: IReport, names: { location?: string | null; client?: string | null } = {}) => ({
		report_id: String(r._id),
		type: r.type,
		sections: r.sections,
		status: r.status,
		trigger: r.trigger,
		schedule_id: r.schedule_id ? String(r.schedule_id) : null,
		location: { location_id: String(r.location_id), name: names.location ?? null },
		client: r.client_id ? { client_id: String(r.client_id), name: names.client ?? null } : null,
		range: r.params?.range ?? '28d',
		run_id: r.params?.run_id ? String(r.params.run_id) : null,
		pdf: r.pdf ? { bytes: r.pdf.bytes, pages: r.pdf.pages } : null,
		failure_reason: r.failure_reason,
		created_at: r.created_at,
		generated_at: r.generated_at,
		expires_at: r.expires_at,
		archived_at: r.archived_at,
	});

	/** Creates and queues a report for a location already checked for access. */
	const createFor = async (location: ILocation, input: Omit<CreateInput, 'location_id'>, meta: CreateMeta) => {
		const sections = resolveSections(input.type, input.sections);
		const run = await precheck(location, input.type, input.run_id);
		const at = now();
		// A report stuck in queued/generating (a lost job) no longer blocks new ones.
		await Report.updateMany(
			{ location_id: location._id, type: input.type, active: true, updated_at: { $lt: new Date(at.getTime() - STUCK_MS) } },
			{ $set: { active: false, status: 'failed', failure_reason: 'generation did not finish (stuck)' } },
		);
		let report: IReport;
		try {
			report = await Report.create({
				organization_id: location.organization_id,
				location_id: location._id,
				client_id: location.client_id ?? null,
				type: input.type,
				sections,
				params: { run_id: run?._id ?? null, range: input.range ?? '28d' },
				trigger: meta.trigger,
				schedule_id: meta.schedule_id ?? null,
				created_by: meta.created_by,
			});
		} catch (err) {
			if ((err as { code?: number }).code !== DUPLICATE_KEY) throw err;
			const existing = await Report.findOne({ location_id: location._id, type: input.type, active: true });
			if (!existing) throw err;
			return { ...viewOf(existing, { location: location.name }), existing: true };
		}
		try {
			await enqueue(JOB_NAMES.REPORT_GENERATE, { report_id: String(report._id) });
		} catch (err) {
			await Report.updateOne({ _id: report._id }, { $set: { active: false, status: 'failed', failure_reason: 'could not be queued' } });
			throw err;
		}
		logger.info(`reports: ${input.type} report ${String(report._id)} queued for location ${String(location._id)} (${meta.trigger})`);
		return { ...viewOf(report, { location: location.name }), existing: false };
	};

	const create = async (ctx: OrgContext, input: CreateInput) => {
		const location = await findAccessibleLocation(ctx, input.location_id);
		if (!location) throw new ApiError(httpStatus.NOT_FOUND, 'Location not found');
		return createFor(location, input, { trigger: 'manual', created_by: ctx.userId });
	};

	// ---- read ----

	const load = async (ctx: OrgContext, reportId: string): Promise<IReport> => {
		if (!Types.ObjectId.isValid(reportId)) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid reportId');
		const report = await Report.findOne({ _id: reportId, ...reportScope(ctx) });
		if (!report) throw new ApiError(httpStatus.NOT_FOUND, 'Report not found');
		return report;
	};

	const namesFor = async (reports: Pick<IReport, 'location_id' | 'client_id'>[]) => {
		const [locations, clients] = await Promise.all([
			Location.find({ _id: { $in: reports.map((r) => r.location_id) } }).select({ name: 1 }).lean(),
			Client.find({ _id: { $in: reports.map((r) => r.client_id).filter(Boolean) } }).select({ company_name: 1 }).lean(),
		]);
		return {
			location: new Map(locations.map((l) => [String(l._id), l.name as string])),
			client: new Map(clients.map((c) => [String(c._id), c.company_name as string])),
		};
	};

	const list = async (
		ctx: OrgContext,
		query: { location_id?: string; client_id?: string; type?: ReportType; status?: ReportStatus | 'archived'; page?: number; limit?: number },
	) => {
		const page = query.page ?? 1;
		const limit = query.limit ?? 20;
		const filter: Record<string, unknown> = { ...reportScope(ctx) };
		if (query.location_id) filter.location_id = new Types.ObjectId(query.location_id);
		if (query.client_id) filter.$and = [{ client_id: new Types.ObjectId(query.client_id) }];
		if (query.type) filter.type = query.type;
		if (query.status === 'archived') filter.archived_at = { $ne: null };
		else {
			filter.archived_at = null;
			if (query.status) filter.status = query.status;
		}
		const [rows, total] = await Promise.all([
			Report.find(filter).sort({ created_at: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean<IReport[]>(),
			Report.countDocuments(filter),
		]);
		const names = await namesFor(rows);
		return {
			reports: rows.map((r) => viewOf(r, { location: names.location.get(String(r.location_id)), client: r.client_id ? names.client.get(String(r.client_id)) : null })),
			page,
			limit,
			total,
		};
	};

	const documentOf = (report: Pick<IReport, 'type' | 'generated_at'>, snapshot: IReportSnapshot) =>
		buildDocument({ type: report.type, location: snapshot.location, branding: snapshot.branding, data: snapshot.data as SnapshotData, generated_at: report.generated_at ?? snapshot.created_at });

	const get = async (ctx: OrgContext, reportId: string) => {
		const report = await load(ctx, reportId);
		const snapshot = report.status === 'ready' ? await ReportSnapshot.findOne({ report_id: report._id }).lean<IReportSnapshot>() : null;
		const names = await namesFor([report]);
		const view = viewOf(report, { location: names.location.get(String(report.location_id)), client: report.client_id ? names.client.get(String(report.client_id)) : null });
		if (!snapshot) return { report: view, snapshot: null, document: null };
		const doc = documentOf(report, snapshot);
		// The logo bytes are served separately (GET /organization/branding/logo); not repeated here.
		const branding = { ...snapshot.branding, logo: snapshot.branding.logo ? { mime: snapshot.branding.logo.mime } : null };
		return {
			report: view,
			snapshot: { location: snapshot.location, data: snapshot.data, sources: snapshot.sources },
			document: { title: doc.title, period: doc.period, generated_at: doc.generated_at, branding, blocks: doc.blocks },
		};
	};

	/** The stored PDF of a ready report (for the owner organization or a share link). */
	const readPdf = async (report: IReport) => {
		if (report.status !== 'ready' || !report.pdf) {
			throw apiErrorWithData(httpStatus.CONFLICT, 'The report is not ready.', { reason: report.status === 'expired' ? 'expired' : 'not_ready', status: report.status });
		}
		const data = await storage.read(storage.pdfPath(String(report.organization_id), String(report._id)));
		if (!data) throw apiErrorWithData(httpStatus.CONFLICT, 'The report file is missing.', { reason: 'file_missing' });
		const location = await Location.findById(report.location_id).select({ name: 1 }).lean<Pick<ILocation, 'name'>>();
		return { data, filename: pdfFilename(location?.name ?? 'report', report.type, report.generated_at ?? report.created_at) };
	};

	const pdf = async (ctx: OrgContext, reportId: string) => readPdf(await load(ctx, reportId));

	const archive = async (ctx: OrgContext, reportId: string) => {
		const report = await load(ctx, reportId);
		if (!report.archived_at) await Report.updateOne({ _id: report._id }, { $set: { archived_at: now() } });
		return { archived: true, report_id: reportId };
	};

	// ---- generation (report-generate job) ----

	const buildData = async (report: IReport, location: ILocation): Promise<{ data: SnapshotData; sources: IReportSnapshot['sources'] }> => {
		const parts: ('rank_tracker' | 'gbp_audit' | 'competitor_analysis' | 'citation')[] = report.type === 'full' ? (report.sections as never[]) : [report.type as never];
		const sectionsFor = (key: (typeof parts)[number]) => (report.type === 'full' ? [...REPORT_SECTIONS[key]] : report.sections);
		const [gbp, bound] = await Promise.all([
			GbpReport.findOne({ location_id: location._id }).lean<IGbpReport>(),
			UserGBP.exists({ location_id: location._id, is_active: true }),
		]);
		const runId = report.params?.run_id ?? null;
		const data: SnapshotData = {};
		let rankRunId: string | null = null;
		for (const key of parts) {
			if (key === 'rank_tracker') {
				const loaded = runId ? await loadRankTrackerData(location._id as Types.ObjectId, runId, sectionsFor(key), withDefaults(location.tracking).keyword_groups) : null;
				data.rank_tracker = loaded ? loaded.data : off('no_rank_run');
				if (loaded) rankRunId = loaded.run_id;
			} else if (key === 'citation') {
				data.citation = await buildCitationData(location, report.params?.range ?? '28d', sectionsFor(key), now());
			} else if (key === 'gbp_audit') {
				if (!bound) data.gbp_audit = off('gbp_not_connected');
				else if (!gbp) data.gbp_audit = off('no_gbp_report');
				else {
					const snap = await GbpProfileSnapshot.findOne({ location_id: location._id, is_latest: true }).sort({ taken_at: -1 }).select({ profile: 1 }).lean<Pick<IGbpProfileSnapshot, 'profile'>>();
					data.gbp_audit = buildGbpAuditData(gbp, snap?.profile ?? null, { name: location.name, mobile: location.mobile ?? null, website_URL: location.website_URL ?? null }, report.params?.range ?? '28d', sectionsFor(key));
				}
			} else {
				if (!gbp) data.competitor_analysis = off('no_gbp_report');
				else if (!gbp.competitors.available) data.competitor_analysis = off((gbp.competitors as PartUnavailable).reason);
				else {
					const run = runId
						? await RankRun.findById(runId).select({ targets: 1, overall: 1, 'tracker.summary': 1 }).lean<Pick<LeanRankRun, 'targets' | 'overall' | 'tracker'>>()
						: null;
					data.competitor_analysis = buildCompetitorData(gbp.competitors, run, sectionsFor(key));
					if (run && !rankRunId) rankRunId = String(runId);
				}
			}
		}
		return { data, sources: { rank_run_id: rankRunId ?? (runId ? String(runId) : null), gbp_report_generated_at: gbp?.generated_at ?? null } };
	};

	const generate = async (reportId: string): Promise<{ status: 'ready' | 'failed' | 'skipped'; pages?: number; bytes?: number }> => {
		const claimed = await Report.findOneAndUpdate({ _id: reportId, status: 'queued' }, { $set: { status: 'generating' } }, { new: true });
		if (!claimed) return { status: 'skipped' };
		const file = storage.pdfPath(String(claimed.organization_id), String(claimed._id));
		try {
			const location = await Location.findById(claimed.location_id).lean<ILocation>();
			if (!location) throw new Error('location not found');
			const client = location.client_id ? await Client.findById(location.client_id).select({ company_name: 1 }).lean<{ company_name?: string }>() : null;
			const { data, sources } = await buildData(claimed, location);
			const branding = await freezeBranding(claimed.organization_id);
			const at = now();
			const snapshotFields = {
				report_id: claimed._id,
				type: claimed.type,
				location: { name: location.name, address: location.address ?? null, city: location.city ?? null, state: location.state ?? null, country: location.country ?? null, client_name: client?.company_name ?? null },
				branding,
				data,
				sources,
			};
			// Idempotent on a retried job: one snapshot per report, written once.
			await ReportSnapshot.updateOne({ report_id: claimed._id }, { $setOnInsert: snapshotFields }, { upsert: true });
			const snapshot = (await ReportSnapshot.findOne({ report_id: claimed._id }).lean<IReportSnapshot>()) as IReportSnapshot;
			const rendered = await renderPdf(documentOf({ type: claimed.type, generated_at: at }, snapshot));
			await storage.write(file, rendered.buffer);
			const expires = DateTime.fromJSDate(at).plus({ months: config.reports.retentionMonths }).toJSDate();
			await Report.updateOne(
				{ _id: claimed._id },
				{
					$set: {
						status: 'ready',
						active: false,
						generated_at: at,
						expires_at: expires,
						failure_reason: null,
						pdf: { file: `${String(claimed._id)}.pdf`, bytes: rendered.buffer.length, pages: rendered.pages, sha256: crypto.createHash('sha256').update(rendered.buffer).digest('hex') },
					},
				},
			);
			logger.info(`reports: report ${String(claimed._id)} ready (${claimed.type}, ${rendered.pages} pages, ${rendered.buffer.length} bytes)`);
			if (claimed.schedule_id) await enqueue(JOB_NAMES.REPORT_EMAIL, { report_id: String(claimed._id), schedule_id: String(claimed.schedule_id) });
			return { status: 'ready', pages: rendered.pages, bytes: rendered.buffer.length };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			await storage.remove(file).catch(() => undefined);
			await Report.updateOne({ _id: claimed._id }, { $set: { status: 'failed', active: false, failure_reason: message.slice(0, 300) } });
			logger.error(`reports: report ${String(claimed._id)} failed: ${message}`);
			if (claimed.schedule_id) await recordScheduleError(claimed.schedule_id, `report generation failed: ${message}`);
			return { status: 'failed' };
		}
	};

	// ---- retention ----

	/** Deletes the PDF and snapshot of reports past REPORT_RETENTION_MONTHS (status `expired`). */
	const expireOld = async (): Promise<number> => {
		const due = await Report.find({ expires_at: { $lte: now() }, status: 'ready' }).select({ _id: 1, organization_id: 1 }).limit(500).lean<IReport[]>();
		for (const r of due) {
			await storage.remove(storage.pdfPath(String(r.organization_id), String(r._id)));
			await ReportSnapshot.deleteOne({ report_id: r._id });
			await Report.updateOne({ _id: r._id }, { $set: { status: 'expired', pdf: null } });
		}
		if (due.length) logger.info(`reports: ${due.length} report(s) expired (retention ${config.reports.retentionMonths} months)`);
		return due.length;
	};

	return { create, createFor, list, get, pdf, readPdf, archive, generate, expireOld, documentOf, load };
};

/** Records a failure on a schedule (shared with the dispatcher and the email job). */
export const recordScheduleError = async (scheduleId: Id, message: string): Promise<void> => {
	await ReportSchedule.updateOne({ _id: scheduleId }, { $set: { last_error: message.slice(0, 300) } });
};

export const reportService = createReportService();

