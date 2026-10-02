import httpStatus from 'http-status';
import { Agenda } from 'agenda';
import config from '../../configs/config';
import { getAgenda } from '../../configs/agenda';
import logger from '../../configs/logger';
import { PlacesApiError, PlacesClient, PlacesConfigError, placesClient } from '../../clients/placesClient';
import { GOOGLE_ATTRIBUTION } from '../../constants/attribution';
import { scheduleJob } from '../../jobs/defineJob';
import { JOB_NAMES } from '../../jobs/jobNames';
import { ISalesAudit, SalesAudit } from '../../models/salesAudit.model';
import { spacingFromRadius } from '../../ranking/points';
import { regionFromCountry } from '../../ranking/region';
import { AUDIT, AUDIT_DETAILS_FIELDS, checklist, countryOf, factsFrom, quickScore } from '../../salesAudit/compute';
import { ApiError, apiErrorWithData } from '../../utils';
import { LIMITS, Limit, hit } from '../auth/rateLimit';
import { renderPdf } from '../reports/render/pdf';
import { withUsage } from '../usage/scope';
import { auditDocument } from './document';

// Sales audit (Phase 19): staff (admins with audits.run) look up a business, audit one keyword, show the
// result and export one PDF. An audit belongs to the staff member who started it; closing it deletes it.

export interface StaffActor {
	id: string;
	name: string | null;
}

export interface SalesAuditDeps {
	places?: Pick<PlacesClient, 'autocomplete' | 'getPlaceDetails'>;
	agenda?: Agenda;
	now?: () => Date;
}

const dailyLimit = (): Limit => ({ name: 'sales-audit:admin', max: config.staffAudit.dailyLimit, windowSeconds: 24 * 3600 });

/** Businesses only: an Autocomplete prediction without 'establishment' is an address or a region. */
const isBusiness = (types: string[]): boolean => types.length === 0 || types.includes('establishment') || types.includes('point_of_interest');

const placesError = (err: unknown): never => {
	if (err instanceof ApiError) throw err;
	if (err instanceof PlacesConfigError) throw apiErrorWithData(httpStatus.SERVICE_UNAVAILABLE, 'Places search is not configured on this server.', { reason: 'places_not_configured' });
	if (err instanceof PlacesApiError) throw apiErrorWithData(httpStatus.BAD_GATEWAY, 'Google Places lookup failed. Try again later.', { reason: 'places_error' });
	throw err;
};

const notFound = () => apiErrorWithData(httpStatus.NOT_FOUND, 'Audit not found. It may have been closed or expired.', { reason: 'audit_not_found' });

/** The API shape of an audit (no internal fields). */
export const auditView = (a: ISalesAudit | (Record<string, unknown> & Partial<ISalesAudit>)) => ({
	id: String(a._id),
	status: a.status,
	keyword: a.keyword,
	business: a.business,
	grid: a.grid,
	result: a.result ?? null,
	warnings: a.warnings ?? [],
	failure_reason: a.failure_reason ?? null,
	api_calls: a.api_calls,
	created_at: a.created_at,
	finished_at: a.finished_at ?? null,
	expires_at: a.expires_at,
	attribution: GOOGLE_ATTRIBUTION,
});

export const createSalesAuditService = (deps: SalesAuditDeps = {}) => {
	const places = deps.places ?? placesClient;
	const now = deps.now ?? (() => new Date());

	/** Business suggestions (US / CA) for the search box; the session ends with POST /staff/audits. */
	const autocomplete = async (actor: StaffActor, input: { input: string; session: string }) => {
		await hit(LIMITS.placesAutocompletePerUser, [`admin:${actor.id}`]);
		try {
			const res = await withUsage({ organization_id: null, location_id: null, purpose: 'sales_audit' }, () =>
				places.autocomplete({ input: input.input, sessionToken: input.session, regionCodes: ['us', 'ca'] }),
			);
			return { suggestions: res.suggestions.filter((s) => isBusiness(s.types)), attribution: GOOGLE_ATTRIBUTION };
		} catch (err) {
			return placesError(err);
		}
	};

	/** Looks the business up (1 Place Details call), stores the audit and queues the job. */
	const start = async (actor: StaffActor, input: { place_id: string; session?: string; keyword: string }) => {
		await hit(dailyLimit(), [actor.id]).catch((err: unknown) => {
			if (!(err instanceof ApiError) || err.statusCode !== httpStatus.TOO_MANY_REQUESTS) throw err;
			const retry = (err.data as { retry_after_seconds?: number } | undefined)?.retry_after_seconds ?? null;
			throw apiErrorWithData(httpStatus.TOO_MANY_REQUESTS, `You can run ${config.staffAudit.dailyLimit} audits per 24 hours.`, {
				reason: 'daily_limit_reached',
				limit: config.staffAudit.dailyLimit,
				retry_after_seconds: retry,
			});
		});
		let details;
		let calls = 0;
		try {
			const res = await withUsage({ organization_id: null, location_id: null, purpose: 'sales_audit' }, () =>
				places.getPlaceDetails(input.place_id, AUDIT_DETAILS_FIELDS, input.session ? { sessionToken: input.session } : {}),
			);
			details = res.details;
			calls = res.apiCalls;
		} catch (err) {
			return placesError(err);
		}
		const country = countryOf(details);
		if (!country) throw apiErrorWithData(httpStatus.BAD_REQUEST, 'Only businesses in the US and Canada can be audited.', { reason: 'unsupported_country' });
		if (!details.location) throw apiErrorWithData(httpStatus.BAD_REQUEST, 'This place has no map position to audit around.', { reason: 'no_location' });
		const facts = factsFrom(details);
		const score = quickScore(facts);
		const created = now();
		const audit = await SalesAudit.create({
			created_by: actor.id,
			keyword: input.keyword.trim().replace(/\s+/g, ' '),
			business: {
				place_id: details.id ?? input.place_id,
				lat: details.location.latitude,
				lng: details.location.longitude,
				country,
				region: regionFromCountry(country),
				...facts,
				score,
				checklist: checklist(facts, score),
			},
			grid: { size: AUDIT.gridSize, radius_km: AUDIT.radiusKm, spacing_km: spacingFromRadius(AUDIT.gridSize, AUDIT.radiusKm) },
			api_calls: { ids_only: 0, pro: 0, details: calls },
			expires_at: new Date(created.getTime() + config.staffAudit.ttlHours * 3600 * 1000),
			created_at: created,
		});
		try {
			await scheduleJob(deps.agenda ?? getAgenda(), JOB_NAMES.SALES_AUDIT, created, { audit_id: String(audit._id) });
		} catch (err) {
			logger.error(`sales audit ${String(audit._id)}: enqueue failed: ${(err as Error).message}`);
			await SalesAudit.updateOne({ _id: audit._id }, { $set: { status: 'failed', failure_reason: 'enqueue_failed', finished_at: now() } });
			audit.status = 'failed';
			audit.failure_reason = 'enqueue_failed';
		}
		logger.info(`sales audit ${String(audit._id)} started by admin ${actor.id}`);
		return auditView(audit.toObject());
	};

	/** The caller's own audit; one stuck in queued / running past 10 minutes is marked failed (timed_out). */
	const load = async (actor: StaffActor, auditId: string) => {
		const audit = await SalesAudit.findOne({ _id: auditId, created_by: actor.id, expires_at: { $gt: now() } }).lean<ISalesAudit>();
		if (!audit) throw notFound();
		if ((audit.status === 'queued' || audit.status === 'running') && now().getTime() - new Date(audit.created_at).getTime() > AUDIT.staleAfterMs) {
			await SalesAudit.updateOne({ _id: audit._id, status: audit.status }, { $set: { status: 'failed', failure_reason: 'timed_out', finished_at: now() } });
			return { ...audit, status: 'failed' as const, failure_reason: 'timed_out' };
		}
		return audit;
	};

	const get = async (actor: StaffActor, auditId: string) => auditView(await load(actor, auditId));

	/** The caller's open audits (so a reloaded page can find them), newest first, without the heavy result. */
	const list = async (actor: StaffActor) => {
		const rows = await SalesAudit.find({ created_by: actor.id, expires_at: { $gt: now() } })
			.select({ result: 0 })
			.sort({ created_at: -1 })
			.limit(50)
			.lean<ISalesAudit[]>();
		return { audits: rows.map((a) => ({ ...auditView(a), result: undefined })) };
	};

	/** Closing an audit deletes it. */
	const remove = async (actor: StaffActor, auditId: string) => {
		const res = await SalesAudit.deleteOne({ _id: auditId, created_by: actor.id });
		if (res.deletedCount === 0) throw notFound();
		return { deleted: true, id: auditId };
	};

	/** One PDF with both parts (ranking + heatmap, then the quick GBP score); rendered on request, never stored. */
	const pdf = async (actor: StaffActor, auditId: string) => {
		const audit = await load(actor, auditId);
		if (audit.status !== 'done') throw apiErrorWithData(httpStatus.CONFLICT, 'The audit is not finished yet.', { reason: 'audit_not_ready', status: audit.status });
		const rendered = await renderPdf(auditDocument(audit, now()));
		const slug = String((audit.business as { name?: string }).name ?? 'business')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '')
			.slice(0, 60);
		return { buffer: rendered.buffer, filename: `audit-${slug || 'business'}-${now().toISOString().slice(0, 10)}.pdf` };
	};

	return { autocomplete, start, get, list, remove, pdf };
};

export const salesAuditService = createSalesAuditService();
