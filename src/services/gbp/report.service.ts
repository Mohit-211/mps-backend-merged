import { Agenda } from 'agenda';
import { Types } from 'mongoose';
import config from '../../configs/config';
import { getAgenda } from '../../configs/agenda';
import logger from '../../configs/logger';
import { scheduleJob } from '../../jobs/defineJob';
import { JOB_NAMES } from '../../jobs/jobNames';
import { GenerateDeps, GenerateResult, generateGbpReport } from '../../gbp/report/generate';
import { ReportRange } from '../../gbp/report/performance';
import { GbpReport, GbpSync, IGbpReport, ILocation, Location, RankRun, ReportTrigger } from '../../models';

// GBP report requests (Phase 7c). A report is generated after each GBP sync and each rank run (and
// when competitors change, or on unbind). Requests are debounced: the first claims
// Location.gbp_report.scheduled_for (compare-and-set) and schedules one gbp-report job
// REPORT_DEBOUNCE_SECONDS later; requests while one is pending do nothing (that run reads the newest
// data). The job skips while a rank run or sync is still active: that job's finish requests again.
// So a monthly refresh (rank run + sync) produces one report.

/** A pending request older than this is assumed lost (e.g. the process died) and can be reclaimed. */
const STALE_REQUEST_MS = 30 * 60 * 1000;

type LocationId = Types.ObjectId | string;

export interface RequestDeps {
	agenda?: Agenda;
	now?: Date;
	debounceSeconds?: number;
}

export interface RequestResult {
	scheduled: boolean;
	scheduled_for: Date | null;
}

export const requestReport = async (locationId: LocationId, trigger: ReportTrigger, deps: RequestDeps = {}): Promise<RequestResult> => {
	const now = deps.now ?? new Date();
	const at = new Date(now.getTime() + (deps.debounceSeconds ?? config.report.debounceSeconds) * 1000);
	const stale = new Date(now.getTime() - STALE_REQUEST_MS);
	const claimed = await Location.findOneAndUpdate(
		{
			_id: locationId,
			is_active: true,
			$or: [{ 'gbp_report.scheduled_for': null }, { 'gbp_report.scheduled_for': { $exists: false } }, { 'gbp_report.scheduled_for': { $lt: stale } }],
		},
		{ $set: { 'gbp_report.scheduled_for': at } },
		{ new: true },
	).lean<ILocation>();
	if (!claimed) {
		const current = await Location.findById(locationId).select({ gbp_report: 1 }).lean<ILocation>();
		return { scheduled: false, scheduled_for: current?.gbp_report?.scheduled_for ?? null };
	}
	try {
		await scheduleJob(deps.agenda ?? getAgenda(), JOB_NAMES.GBP_REPORT, at, { location_id: String(locationId), trigger });
	} catch (err) {
		await Location.updateOne({ _id: locationId }, { $set: { 'gbp_report.scheduled_for': null } });
		throw err;
	}
	return { scheduled: true, scheduled_for: at };
};

/** A best-effort request for hooks: never throws (the triggering job has already finished). */
export const requestReportSafely = async (locationId: LocationId, trigger: ReportTrigger, deps: RequestDeps = {}): Promise<void> => {
	try {
		await requestReport(locationId, trigger, deps);
	} catch (err) {
		logger.error(`gbp-report: request for location ${String(locationId)} (${trigger}) failed: ${(err as Error).message}`);
	}
};

/** Manual refresh: the next generation refetches competitor Place Details older than 24 h. */
export const forceCompetitorRefresh = (locationId: LocationId, now: Date = new Date()) =>
	Location.updateOne({ _id: locationId }, { $set: { 'gbp_report.force_competitors_at': now } });

export type ReportJobResult = GenerateResult | { skipped: 'run_active' | 'location_not_found' };

/** The gbp-report job body. */
export const runReportJob = async (locationId: string, trigger: ReportTrigger, deps: GenerateDeps = {}): Promise<ReportJobResult> => {
	await Location.updateOne({ _id: locationId }, { $set: { 'gbp_report.scheduled_for': null } });
	const [run, sync] = await Promise.all([
		RankRun.exists({ location_id: locationId, active: true }),
		GbpSync.exists({ location_id: locationId, active: true }),
	]);
	if (run || sync) {
		logger.info(`gbp-report: location ${locationId} skipped: a ${run ? 'rank run' : 'GBP sync'} is still active (it requests a report when it finishes)`);
		return { skipped: 'run_active' };
	}
	const result = await generateGbpReport(locationId, trigger, deps);
	return result ?? { skipped: 'location_not_found' };
};

export interface ReportState {
	pending: boolean;
	scheduled_for: Date | null;
	last_generated_at: Date | null;
}

export const reportState = (location: Pick<ILocation, 'gbp_report'>, now: Date = new Date()): ReportState => {
	const scheduled = location.gbp_report?.scheduled_for ?? null;
	return {
		pending: scheduled !== null && scheduled.getTime() >= now.getTime() - STALE_REQUEST_MS,
		scheduled_for: scheduled,
		last_generated_at: location.gbp_report?.last_generated_at ?? null,
	};
};

/** GET view: the stored report with one range's performance. null before the first generation. */
export const getReportView = async (location: ILocation, range: ReportRange, now: Date = new Date()) => {
	const report = await GbpReport.findOne({ location_id: location._id }).lean<IGbpReport>();
	if (!report) return null;
	const performance = report.performance.available
		? { available: true as const, latest_date: report.performance.latest_date, ...report.performance.ranges[range] }
		: report.performance;
	return {
		location_id: String(location._id),
		generated_at: report.generated_at,
		trigger: report.trigger,
		gbp_connected: report.gbp_connected,
		v4_enabled: report.v4_enabled,
		range,
		gbp_score: report.gbp_score,
		performance,
		keywords: report.keywords,
		reviews: report.reviews,
		media: report.media,
		posts: report.posts,
		pending_google_edits: report.pending_google_edits,
		verification: report.verification,
		competitors: report.competitors,
		sync: report.sync,
		score_history: report.score_history,
		api_calls: report.api_calls,
		inputs: report.inputs,
		generation: reportState(location, now),
	};
};
