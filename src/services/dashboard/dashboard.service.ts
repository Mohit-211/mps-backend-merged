import { Client, IClient, ILocation, ILocationSummary, Location, LocationMovement } from '../../models';
import { gradeFor } from '../../gbp/scoring.config';
import { LocationStatus, statusesFor } from '../locations/status';
import { OrgContext } from '../org/context';
import { clientScope, locationScope } from '../org/access';
import { RecommendedAction, recommendedActions } from './actions';

// GET /dashboard (Phase 11, roadmap PDF §6). Business or Agency shape by organization type; a
// client_user gets the agency shape limited to its clients. Reads only the stored per-location
// summaries (Location.summary), the batched status and the client names: never the full rank-run or
// report documents, and never Google.

export const DASHBOARD_SORTS = ['name', 'client', 'rank', 'rank_change', 'gbp_score'] as const;
export type DashboardSort = (typeof DASHBOARD_SORTS)[number];

export interface DashboardQuery {
	page?: number;
	limit?: number;
	sort?: DashboardSort;
	order?: 'asc' | 'desc';
}

type Summary = Partial<ILocationSummary>;

interface Item {
	location_id: string;
	name: string;
	client: { client_id: string; name: string } | null;
	status: LocationStatus;
	gbp_connected: boolean;
	summary: Summary;
	last_refreshed_at: Date | null;
	next_refresh_at: Date | null;
}

const round = (v: number, d: number): number => Math.round((v + Number.EPSILON) * 10 ** d) / 10 ** d;
const mean = (values: (number | null | undefined)[], decimals = 1): number | null => {
	const nums = values.filter((v): v is number => typeof v === 'number');
	return nums.length ? round(nums.reduce((s, v) => s + v, 0) / nums.length, decimals) : null;
};

const STATUS_KEYS: LocationStatus[] = ['active', 'setup_required', 'gbp_not_connected', 'reconnect_required'];

const loadItems = async (ctx: OrgContext): Promise<Item[]> => {
	const locations = await Location.find(locationScope(ctx))
		.select({ name: 1, client_id: 1, summary: 1, onboarding: 1, 'tracking.keywords': 1, refresh: 1, 'gbp_sync.last_synced_at': 1, gbp_connected: 1 })
		.sort({ name: 1 })
		.lean<ILocation[]>();
	const statuses = await statusesFor(locations);
	const clientIds = [...new Set(locations.map((l) => l.client_id && String(l.client_id)).filter(Boolean))] as string[];
	const clients = clientIds.length ? await Client.find({ _id: { $in: clientIds } }).select({ company_name: 1 }).lean<IClient[]>() : [];
	const clientName = new Map(clients.map((c) => [String(c._id), c.company_name]));
	return locations.map((l) => {
		const dates = [l.summary?.last_run_at, l.gbp_sync?.last_synced_at].filter((d): d is Date => d instanceof Date);
		return {
			location_id: String(l._id),
			name: l.name,
			client: l.client_id && clientName.has(String(l.client_id)) ? { client_id: String(l.client_id), name: clientName.get(String(l.client_id)) as string } : null,
			status: statuses.get(String(l._id)) as LocationStatus,
			gbp_connected: Boolean(l.gbp_connected),
			summary: l.summary ?? {},
			last_refreshed_at: dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null,
			next_refresh_at: l.refresh?.next_refresh_at ?? null,
		};
	});
};

const statusCounts = (items: Item[]): Record<LocationStatus, number> =>
	Object.fromEntries(STATUS_KEYS.map((k) => [k, items.filter((i) => i.status === k).length])) as Record<LocationStatus, number>;

const actionsFor = (items: Item[]): RecommendedAction[] =>
	recommendedActions(items.map((i) => ({ location_id: i.location_id, name: i.name, status: i.status, summary: i.summary })));

const gbpBlock = (items: Item[]) => {
	const scored = items.filter((i) => typeof i.summary.gbp_score === 'number');
	if (!scored.length) return { available: false as const, reason: items.some((i) => i.gbp_connected) ? 'no_report' : 'gbp_not_connected' };
	const score = mean(scored.map((i) => i.summary.gbp_score), 0) as number;
	return {
		available: true as const,
		score,
		grade: scored.length === 1 ? (scored[0].summary.gbp_grade ?? gradeFor(score)) : gradeFor(score),
		change: mean(scored.map((i) => i.summary.gbp_score_change)),
		partial: scored.some((i) => i.summary.gbp_partial),
	};
};

const reviewsBlock = (items: Item[]) => {
	const withReviews = items.filter((i) => i.summary.reviews_available);
	const publicRated = items.filter((i) => typeof i.summary.rating === 'number');
	const count = (list: Item[]) => list.reduce((s, i) => s + (i.summary.review_count ?? 0), 0);
	const weighted = (list: Item[]) => {
		const total = count(list);
		return total > 0 ? round(list.reduce((s, i) => s + (i.summary.rating ?? 0) * (i.summary.review_count ?? 0), 0) / total, 1) : mean(list.map((i) => i.summary.rating));
	};
	if (withReviews.length) {
		return { available: true as const, rating: weighted(withReviews), count: count(withReviews), unreplied: withReviews.reduce((s, i) => s + (i.summary.unreplied ?? 0), 0) };
	}
	return {
		available: false as const,
		reason: items.some((i) => i.gbp_connected) ? 'v4_access_pending' : 'gbp_not_connected',
		// The public rating and count from Place Details (competitor comparison), when known.
		public_rating: publicRated.length ? weighted(publicRated) : null,
		public_review_count: publicRated.length ? count(publicRated) : null,
	};
};

const movementOf = (items: Item[]): LocationMovement => {
	const total: LocationMovement = { improved: 0, declined: 0, unchanged: 0, entered_top_60: 0, dropped_out_of_top_60: 0, not_comparable: 0 };
	for (const i of items) for (const k of Object.keys(total) as (keyof LocationMovement)[]) total[k] += i.summary.movement?.[k] ?? 0;
	return total;
};

/** Averages aligned from the latest run backwards (one location: its own trend). */
const trendOf = (items: Item[]): { run_at: Date | null; avg_rank: number | null }[] => {
	const trends = items.map((i) => i.summary.rank_trend ?? []).filter((t) => t.length);
	if (!trends.length) return [];
	if (trends.length === 1) return trends[0].map((p) => ({ run_at: p.run_at, avg_rank: p.overall_avg_rank }));
	const len = Math.max(...trends.map((t) => t.length));
	const out: { run_at: Date | null; avg_rank: number | null }[] = [];
	for (let back = len - 1; back >= 0; back -= 1) {
		const points = trends.map((t) => t[t.length - 1 - back]).filter(Boolean);
		out.push({ run_at: null, avg_rank: mean(points.map((p) => p.overall_avg_rank)) });
	}
	return out;
};

const keyCompetitorOf = (items: Item[]) => {
	const candidates = items
		.filter((i) => i.summary.key_competitor)
		.map((i) => ({ ...(i.summary.key_competitor as NonNullable<ILocationSummary['key_competitor']>), location_id: i.location_id, location_name: i.name }));
	if (!candidates.length) return null;
	const gap = (c: (typeof candidates)[number]) => (c.ahead ? (c.self_avg_rank ?? 61) - (c.avg_rank ?? 61) : -Infinity);
	return [...candidates].sort((a, b) => gap(b) - gap(a) || (a.avg_rank ?? 61) - (b.avg_rank ?? 61))[0];
};

const visibilityOf = (items: Item[]) => ({
	avg_rank: mean(items.map((i) => i.summary.overall_avg_rank)),
	change: mean(items.map((i) => i.summary.overall_change)),
	top3_rate: mean(items.map((i) => i.summary.top3_rate), 2),
});

/** Phase 16: Citation Health across the locations (from Location.summary). */
const citationsBlock = (items: Item[]) => {
	const scored = items.filter((i) => typeof i.summary.citation_score === 'number');
	const listed = items.filter((i) => (i.summary.citation_total ?? 0) > 0);
	const sum = (key: string) => listed.reduce((s, i) => s + (i.summary.citation_counts?.[key] ?? 0), 0);
	if (!scored.length) return { available: false as const, reason: listed.length ? 'not_checked_yet' : 'no_citations_yet' };
	const score = mean(scored.map((i) => i.summary.citation_score), 0) as number;
	return {
		available: true as const,
		score,
		grade: scored.length === 1 ? (scored[0].summary.citation_grade ?? gradeFor(score)) : gradeFor(score),
		coverage: mean(listed.map((i) => i.summary.citation_coverage), 2),
		listings: listed.reduce((s, i) => s + (i.summary.citation_total ?? 0), 0),
		live_correct: sum('live_correct'),
		nap_wrong: sum('nap_wrong'),
		not_found: sum('not_found'),
		not_checked: sum('not_checked'),
	};
};

const refreshOf = (items: Item[]) => {
	const last = items.map((i) => i.last_refreshed_at).filter((d): d is Date => d instanceof Date);
	const next = items.map((i) => i.next_refresh_at).filter((d): d is Date => d instanceof Date);
	return {
		last_refreshed_at: last.length ? new Date(Math.max(...last.map((d) => d.getTime()))) : null,
		next_refresh_at: next.length ? new Date(Math.min(...next.map((d) => d.getTime()))) : null,
	};
};

const businessDashboard = (items: Item[]) => ({
	type: 'business' as const,
	locations_count: items.length,
	visibility: { ...visibilityOf(items), trend: trendOf(items) },
	gbp: gbpBlock(items),
	reviews: reviewsBlock(items),
	citations: citationsBlock(items),
	movement: movementOf(items),
	key_competitor: keyCompetitorOf(items),
	recommended_actions: actionsFor(items),
	refresh: refreshOf(items),
	status_counts: statusCounts(items),
	locations: items.map((i) => ({
		location_id: i.location_id,
		name: i.name,
		status: i.status,
		avg_rank: i.summary.overall_avg_rank ?? null,
		change: i.summary.overall_change ?? null,
		gbp_score: i.summary.gbp_score ?? null,
		citation_score: i.summary.citation_score ?? null,
	})),
});

const tableValue = (i: Item, sort: DashboardSort): string | number | null => {
	switch (sort) {
		case 'client':
			return i.client?.name ?? null;
		case 'rank':
			return i.summary.overall_avg_rank ?? null;
		case 'rank_change':
			return i.summary.overall_change ?? null;
		case 'gbp_score':
			return i.summary.gbp_score ?? null;
		default:
			return i.name;
	}
};

/** In-memory sort (nulls last in both directions) and page of the portfolio table. */
const tableOf = (items: Item[], query: DashboardQuery) => {
	const sort = query.sort ?? 'name';
	const dir = query.order === 'desc' ? -1 : 1;
	const page = Math.max(1, query.page ?? 1);
	const limit = Math.min(100, Math.max(1, query.limit ?? 25));
	const sorted = [...items].sort((a, b) => {
		const x = tableValue(a, sort);
		const y = tableValue(b, sort);
		if (x === null && y === null) return a.name.localeCompare(b.name);
		if (x === null) return 1;
		if (y === null) return -1;
		const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
		return cmp * dir || a.name.localeCompare(b.name);
	});
	return {
		rows: sorted.slice((page - 1) * limit, page * limit).map((i) => ({
			location_id: i.location_id,
			name: i.name,
			client: i.client,
			status: i.status,
			visibility: { avg_rank: i.summary.overall_avg_rank ?? null, change: i.summary.overall_change ?? null, top3_rate: i.summary.top3_rate ?? null },
			gbp: typeof i.summary.gbp_score === 'number' ? { score: i.summary.gbp_score, grade: i.summary.gbp_grade ?? null, change: i.summary.gbp_score_change ?? null } : null,
			citations: typeof i.summary.citation_score === 'number' ? { score: i.summary.citation_score, grade: i.summary.citation_grade ?? null, nap_wrong: i.summary.citation_counts?.nap_wrong ?? 0 } : null,
		})),
		page,
		limit,
		total: items.length,
	};
};

const MAX_LISTED = 10;

const agencyDashboard = (items: Item[], clientsCount: number, query: DashboardQuery) => {
	const declines = items
		.filter((i) => (i.summary.overall_change ?? 0) < 0 || (i.summary.movement?.dropped_out_of_top_60 ?? 0) > 0)
		.map((i) => ({
			location_id: i.location_id,
			name: i.name,
			client: i.client,
			change: i.summary.overall_change ?? null,
			declined_keywords: i.summary.movement?.declined ?? 0,
			dropped_out: i.summary.movement?.dropped_out_of_top_60 ?? 0,
		}))
		.sort((a, b) => b.dropped_out - a.dropped_out || (a.change ?? 0) - (b.change ?? 0))
		.slice(0, MAX_LISTED);
	const gbpIssues = items
		.map((i) => ({
			location_id: i.location_id,
			name: i.name,
			client: i.client,
			issues: [
				...(i.status === 'reconnect_required' ? [{ id: 'reconnect_required', label: 'The Google connection was revoked: reconnect' }] : []),
				...(i.summary.gbp_issues ?? []),
			],
		}))
		.filter((i) => i.issues.length)
		.sort((a, b) => b.issues.length - a.issues.length || a.name.localeCompare(b.name))
		.slice(0, MAX_LISTED);
	const scored = items.filter((i) => typeof i.summary.gbp_score === 'number');
	return {
		type: 'agency' as const,
		clients_count: clientsCount,
		locations_count: items.length,
		portfolio: {
			avg_rank: mean(items.map((i) => i.summary.overall_avg_rank)),
			avg_rank_change: mean(items.map((i) => i.summary.overall_change)),
			avg_top3_rate: mean(items.map((i) => i.summary.top3_rate), 2),
			avg_gbp_score: mean(scored.map((i) => i.summary.gbp_score)),
			avg_gbp_score_change: mean(scored.map((i) => i.summary.gbp_score_change)),
			avg_citation_score: mean(items.filter((i) => typeof i.summary.citation_score === 'number').map((i) => i.summary.citation_score)),
		},
		citations: citationsBlock(items),
		status_counts: statusCounts(items),
		declines,
		gbp_issues: gbpIssues,
		recommended_actions: actionsFor(items),
		table: tableOf(items, query),
	};
};

export const getDashboard = async (ctx: OrgContext, query: DashboardQuery = {}) => {
	const items = await loadItems(ctx);
	if (ctx.organization.type !== 'agency') return businessDashboard(items);
	const clientsCount = await Client.countDocuments(clientScope(ctx));
	return agencyDashboard(items, clientsCount, query);
};
