import { Types } from 'mongoose';
import httpStatus from 'http-status';
import { Client, GbpReport, IClient, IGbpReport, ILocation, Location, RankRun, UserGBP } from '../../models';
import { ApiError } from '../../utils';
import { withDefaults } from '../ranking/trackingSettings';
import { getRefreshState } from '../refresh/refresh.service';
import { OrgContext } from '../org/context';
import { locationScope } from '../org/access';
import { LocationStatus, statusesFor } from './status';

// The organization's locations (Phase 8): the /locations table, the location header and overview.
// Everything reads stored data only.

export const LIST_SORTS = ['name', 'city', 'rank', 'gbp_score', 'rating', 'last_refreshed'] as const;
export type ListSort = (typeof LIST_SORTS)[number];

export interface ListQuery {
	search?: string;
	client_id?: string;
	status?: LocationStatus;
	sort?: ListSort;
	order?: 'asc' | 'desc';
	page?: number;
	limit?: number;
}

export interface LocationRow {
	location_id: string;
	name: string;
	city: string;
	country: string;
	client: { client_id: string; name: string } | null;
	source: ILocation['source'] | null;
	gbp_connected: boolean;
	status: LocationStatus;
	rank: { overall_avg_rank: number | null; change: number | null } | null;
	gbp: { score: number; grade: string | null; partial: boolean | null } | null;
	reviews: { rating: number | null; count: number | null } | null;
	last_refreshed_at: Date | null;
	next_refresh_at: Date | null;
}

const SORT_FIELD: Record<ListSort, string> = {
	name: 'name',
	city: 'city',
	rank: 'summary.overall_avg_rank',
	gbp_score: 'summary.gbp_score',
	rating: 'summary.rating',
	last_refreshed: 'summary.last_run_at',
};

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const lastRefreshed = (l: ILocation): Date | null => {
	const dates = [l.summary?.last_run_at, l.gbp_sync?.last_synced_at].filter((d): d is Date => d instanceof Date);
	return dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
};

const clientNames = async (locations: Pick<ILocation, 'client_id'>[]): Promise<Map<string, string>> => {
	const ids = [...new Set(locations.map((l) => l.client_id && String(l.client_id)).filter(Boolean))] as string[];
	if (!ids.length) return new Map();
	const clients = await Client.find({ _id: { $in: ids } }).select({ company_name: 1 }).lean<IClient[]>();
	return new Map(clients.map((c) => [String(c._id), c.company_name]));
};

export const toRow = (l: ILocation, status: LocationStatus, clients: Map<string, string>): LocationRow => ({
	location_id: String(l._id),
	name: l.name,
	city: l.city,
	country: l.country,
	client: l.client_id && clients.has(String(l.client_id)) ? { client_id: String(l.client_id), name: clients.get(String(l.client_id)) as string } : null,
	source: l.source ?? null,
	gbp_connected: Boolean(l.gbp_connected),
	status,
	rank: l.summary && (l.summary.overall_avg_rank !== null || l.summary.last_run_at) ? { overall_avg_rank: l.summary.overall_avg_rank, change: l.summary.overall_change } : null,
	gbp: typeof l.summary?.gbp_score === 'number' ? { score: l.summary.gbp_score, grade: l.summary.gbp_grade, partial: l.summary.gbp_partial } : null,
	reviews: l.summary && (l.summary.rating !== null || l.summary.review_count !== null) ? { rating: l.summary.rating, count: l.summary.review_count } : null,
	last_refreshed_at: lastRefreshed(l),
	next_refresh_at: l.refresh?.next_refresh_at ?? null,
});

/** Rows for a set of locations (statuses and client names in batched queries). */
export const rowsFor = async (locations: ILocation[]): Promise<LocationRow[]> => {
	const [statuses, clients] = await Promise.all([statusesFor(locations), clientNames(locations)]);
	return locations.map((l) => toRow(l, statuses.get(String(l._id)) as LocationStatus, clients));
};

/**
 * GET /locations. Search (name, city, address), filter (client, status), sort, pagination. The status
 * filter is applied after the status is computed, so with it the page is taken from the filtered set.
 */
export const listLocations = async (ctx: OrgContext, query: ListQuery) => {
	const page = Math.max(1, query.page ?? 1);
	const limit = Math.min(100, Math.max(1, query.limit ?? 25));
	const filter: Record<string, unknown> = { ...locationScope(ctx) };
	if (query.client_id) {
		if (!Types.ObjectId.isValid(query.client_id)) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid client_id');
		filter.client_id = ctx.membership.role === 'client_user' && !ctx.membership.client_ids.some((c) => String(c) === query.client_id) ? { $in: [] } : new Types.ObjectId(query.client_id);
	}
	if (query.search) {
		const re = new RegExp(escapeRegex(query.search.trim()), 'i');
		filter.$or = [{ name: re }, { city: re }, { address: re }];
	}
	const direction = query.order === 'desc' ? -1 : 1;
	const sort: Record<string, 1 | -1> = { [SORT_FIELD[query.sort ?? 'name']]: direction, _id: 1 };

	if (query.status) {
		const all = await Location.find(filter).sort(sort).lean<ILocation[]>();
		const rows = (await rowsFor(all)).filter((r) => r.status === query.status);
		return { locations: rows.slice((page - 1) * limit, page * limit), page, limit, total: rows.length };
	}
	const [locations, total] = await Promise.all([
		Location.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).lean<ILocation[]>(),
		Location.countDocuments(filter),
	]);
	return { locations: await rowsFor(locations), page, limit, total };
};

/** The location header (GET /locations/:id), for a location already access-checked. */
export const locationHeader = async (location: ILocation) => {
	const [row] = await rowsFor([location]);
	return {
		location_id: String(location._id),
		name: location.name,
		address: location.address,
		city: location.city,
		state: location.state,
		country: location.country,
		zip_code: location.zip_code,
		phone: location.mobile && location.mobile !== 'n/a' ? location.mobile : null,
		website: location.website_URL && location.website_URL !== 'n/a' ? location.website_URL : null,
		business_category: location.business_category,
		place_id: location.place_id ?? null,
		source: location.source ?? null,
		gbp_connected: Boolean(location.gbp_connected),
		status: row.status,
		client: row.client,
		lat: typeof location.lat === 'number' ? location.lat : null,
		lng: typeof location.lng === 'number' ? location.lng : null,
		timezone: location.timezone ?? null,
		onboarding: location.onboarding ?? null,
		created_at: location.created_at,
	};
};

const unavailable = (reason: string) => ({ available: false as const, reason });

/** GET /locations/:id/overview: the header plus the latest stored summary of every module. */
export const locationOverview = async (location: ILocation) => {
	const header = await locationHeader(location);
	const tracking = withDefaults(location.tracking);
	const [runs, report, bound, refresh] = await Promise.all([
		RankRun.find({ location_id: location._id, status: { $in: ['done', 'partial'] } })
			.sort({ run_at: -1 })
			.limit(6)
			.select({ overall: 1, run_at: 1, finished_at: 1, status: 1 })
			.lean<{ _id: Types.ObjectId; overall?: Record<string, { overallAvgRank: number | null; change: number | null }>; run_at: Date; status: string }[]>(),
		GbpReport.findOne({ location_id: location._id }).lean<IGbpReport>(),
		UserGBP.exists({ location_id: location._id, is_active: true }),
		getRefreshState(location),
	]);
	const latest = runs[0];
	const rankings = latest
		? {
				available: true as const,
				run_id: String(latest._id),
				run_at: latest.run_at,
				status: latest.status,
				overall_avg_rank: latest.overall?.self?.overallAvgRank ?? null,
				change: latest.overall?.self?.change ?? null,
				keywords: tracking.keywords.length,
				trend: [...runs].reverse().map((r) => ({ run_at: r.run_at, overall_avg_rank: r.overall?.self?.overallAvgRank ?? null })),
			}
		: unavailable(tracking.keywords.length ? 'no_ranking_data' : 'no_keywords');

	const noReport = unavailable('no_report');
	const gbp = report
		? report.gbp_score.available
			? {
					available: true as const,
					score: report.gbp_score.score,
					grade: report.gbp_score.grade,
					partial: report.gbp_score.partial,
					top_fixes: report.gbp_score.top_fixes.slice(0, 3).map((f) => ({ id: f.id, label: f.label, fix_hint: f.fix_hint })),
				}
			: report.gbp_score
		: bound
			? noReport
			: unavailable('gbp_not_connected');
	const perf = report?.performance;
	const performance = perf
		? perf.available
			? {
					available: true as const,
					range: '28d',
					impressions: perf.ranges['28d'].totals.impressions,
					actions: perf.ranges['28d'].totals.actions,
					impressions_change: perf.ranges['28d'].previous_period.change.impressions,
					actions_change: perf.ranges['28d'].previous_period.change.actions,
				}
			: perf
		: bound
			? noReport
			: unavailable('gbp_not_connected');
	const reviews = report?.reviews
		? report.reviews.available
			? { available: true as const, rating: report.reviews.average_rating, count: report.reviews.total, unreplied: report.reviews.unreplied.length }
			: report.reviews
		: bound
			? noReport
			: unavailable('gbp_not_connected');
	const rows = report?.competitors?.available ? report.competitors.rows : null;
	const self = rows?.find((r) => r.is_self);
	const best = rows?.filter((r) => !r.is_self && r.public_score).sort((a, b) => (b.public_score?.score ?? 0) - (a.public_score?.score ?? 0))[0];
	const competitors = rows
		? {
				available: true as const,
				tracked: tracking.competitors.length,
				compared: rows.filter((r) => !r.is_self).length,
				public_score: self?.public_score?.score ?? null,
				best_competitor: best ? { place_id: best.place_id, name: best.name, public_score: best.public_score?.score ?? null } : null,
			}
		: report?.competitors ?? unavailable(tracking.competitors.length ? 'no_report' : 'no_competitors');

	return {
		...header,
		rankings,
		gbp,
		performance,
		reviews,
		competitors,
		refresh,
		empty_states: {
			no_keywords: tracking.keywords.length === 0,
			no_competitors: tracking.competitors.length === 0,
			no_ranking_data: !latest,
			gbp_not_connected: !bound,
			no_reports: !report,
		},
	};
};

export interface LocationUpdate {
	name?: string;
	timezone?: string | null;
	client_id?: string | null;
}

/** PATCH /locations/:id (owner/member): only fields that don't come from GBP / Places. */
export const updateLocation = async (ctx: OrgContext, location: ILocation, update: LocationUpdate) => {
	const set: Record<string, unknown> = {};
	if (update.name !== undefined) set.name = update.name;
	if (update.timezone !== undefined) set.timezone = update.timezone;
	if (update.client_id !== undefined) {
		if (update.client_id === null) set.client_id = null;
		else {
			if (ctx.organization.type !== 'agency') throw new ApiError(httpStatus.FORBIDDEN, 'Clients are available to agency organizations only.');
			const client = await Client.findOne({ _id: update.client_id, organization_id: ctx.organization._id, is_active: true }).select({ _id: 1 }).lean();
			if (!client) throw new ApiError(httpStatus.NOT_FOUND, 'Client not found');
			set.client_id = client._id;
		}
	}
	await Location.updateOne({ _id: location._id }, { $set: set });
	return locationHeader((await Location.findById(location._id).lean<ILocation>()) as ILocation);
};
