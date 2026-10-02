import { Types } from 'mongoose';
import { DateTime } from 'luxon';
import { GbpMetricDaily, GbpReview, Report, ReportSchedule } from '../../models';
import { actionsPer1000, changeOf, comparable, indexByDate, MetricRow, performanceWindow, PeriodTotals, sumPeriods } from '../../gbp/report/performance';
import { OrgContext } from '../org/context';
import { scheduleScope } from '../reports/schedule.service';

// Dashboard numbers that depend on the period picker (2026-10-02): GBP performance and the rating change
// over 15 / 30 / 60 days, plus the agency's report counts. Read from stored data only (GbpMetricDaily,
// GbpReview, reports), never Google, so they change only after a refresh.

export const DASHBOARD_RANGES = ['15d', '30d', '60d'] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];
export const DEFAULT_DASHBOARD_RANGE: DashboardRange = '30d';
export const DASHBOARD_RANGE_DAYS: Record<DashboardRange, number> = { '15d': 15, '30d': 30, '60d': 60 };

/** Google's performance data lags a few days; rows this far back cover both windows of the longest range. */
const LAG_ALLOWANCE_DAYS = 45;

const toIds = (ids: string[]) => ids.map((id) => new Types.ObjectId(id));

const PERFORMANCE_KEYS = ['impressions', 'maps', 'search', 'actions', 'calls', 'website_clicks', 'direction_requests'] as const satisfies readonly (keyof PeriodTotals)[];
type PerformanceKey = (typeof PERFORMANCE_KEYS)[number];

const pickTotals = (totals: PeriodTotals) => Object.fromEntries(PERFORMANCE_KEYS.map((k) => [k, totals[k]])) as Record<PerformanceKey, number>;

export type PerformanceBlock =
	| {
			available: true;
			range: DashboardRange;
			days: number;
			/** The newest day with data across the locations (Google lags a few days). */
			latest_date: string;
			current: Record<PerformanceKey, number> & { actions_per_1000_impressions: number | null };
			previous: Record<PerformanceKey, number> & { actions_per_1000_impressions: number | null };
			/** Fractional change vs the previous window (0.12 = +12 %); null when either window lacks data coverage or the base is 0. */
			change: Record<PerformanceKey | 'actions_per_1000_impressions', number | null>;
			coverage: { current: { days_with_data: number; days: number }; previous: { days_with_data: number; days: number } };
	  }
	| { available: false; reason: 'gbp_not_connected' | 'no_data'; range: DashboardRange };

/** GBP performance over the range for the given locations, each window ending at that location's latest day with data. */
export const performanceBlock = async (locationIds: string[], anyConnected: boolean, range: DashboardRange, now: Date = new Date()): Promise<PerformanceBlock> => {
	if (!anyConnected) return { available: false, reason: 'gbp_not_connected', range };
	const days = DASHBOARD_RANGE_DAYS[range];
	const since = DateTime.fromJSDate(now, { zone: 'UTC' })
		.minus({ days: 2 * days + LAG_ALLOWANCE_DAYS })
		.toISODate() as string;
	const rows = locationIds.length
		? await GbpMetricDaily.find({ location_id: { $in: toIds(locationIds) }, date: { $gte: since } })
				.select({ location_id: 1, date: 1, metric: 1, value: 1, _id: 0 })
				.lean<(MetricRow & { location_id: Types.ObjectId })[]>()
		: [];
	if (!rows.length) return { available: false, reason: 'no_data', range };
	const byLocation = new Map<string, MetricRow[]>();
	for (const r of rows) {
		const key = String(r.location_id);
		const list = byLocation.get(key);
		if (list) list.push(r);
		else byLocation.set(key, [r]);
	}
	const windows = [...byLocation.values()].map((list) => {
		const latest = list.reduce((max, r) => (r.date > max ? r.date : max), list[0].date);
		return { latest, ...performanceWindow(indexByDate(list), latest, days) };
	});
	const current = sumPeriods(windows.map((w) => w.current));
	const previous = sumPeriods(windows.map((w) => w.previous));
	const ok = comparable(current.coverage) && comparable(previous.coverage);
	const rateNow = actionsPer1000(current.totals);
	const ratePrev = actionsPer1000(previous.totals);
	return {
		available: true,
		range,
		days,
		latest_date: windows.reduce((max, w) => (w.latest > max ? w.latest : max), windows[0].latest),
		current: { ...pickTotals(current.totals), actions_per_1000_impressions: rateNow },
		previous: { ...pickTotals(previous.totals), actions_per_1000_impressions: ratePrev },
		change: {
			...(Object.fromEntries(PERFORMANCE_KEYS.map((k) => [k, changeOf(current.totals[k], previous.totals[k], ok)])) as Record<PerformanceKey, number | null>),
			actions_per_1000_impressions: rateNow !== null && ratePrev !== null ? changeOf(rateNow, ratePrev, ok) : null,
		},
		coverage: { current: current.coverage, previous: previous.coverage },
	};
};

/**
 * The average rating now minus the average of the reviews that existed at the start of the range (2 decimals),
 * and the reviews received in the range. Null change without reviews before the range.
 */
export const ratingChange = async (locationIds: string[], range: DashboardRange, now: Date = new Date()): Promise<{ rating_change: number | null; new_in_range: number }> => {
	if (!locationIds.length) return { rating_change: null, new_in_range: 0 };
	const cutoff = new Date(now.getTime() - DASHBOARD_RANGE_DAYS[range] * 86_400_000);
	const rated = { $gt: ['$rating', null] };
	const before = { $lt: ['$create_time', cutoff] };
	const [row] = await GbpReview.aggregate<{ n: number; sum: number; n_before: number; sum_before: number; new_in_range: number }>([
		{ $match: { location_id: { $in: toIds(locationIds) } } },
		{
			$group: {
				_id: null,
				n: { $sum: { $cond: [rated, 1, 0] } },
				sum: { $sum: { $ifNull: ['$rating', 0] } },
				n_before: { $sum: { $cond: [{ $and: [rated, before] }, 1, 0] } },
				sum_before: { $sum: { $cond: [before, { $ifNull: ['$rating', 0] }, 0] } },
				new_in_range: { $sum: { $cond: [{ $gte: ['$create_time', cutoff] }, 1, 0] } },
			},
		},
	]);
	if (!row || !row.n || !row.n_before) return { rating_change: null, new_in_range: row?.new_in_range ?? 0 };
	return { rating_change: Math.round((row.sum / row.n - row.sum_before / row.n_before) * 100) / 100, new_in_range: row.new_in_range };
};

/** The agency's reports: ready and failed (not archived) for the visible locations, and active schedules. */
export const reportCounts = async (ctx: OrgContext, locationIds: string[]): Promise<{ ready: number; scheduled: number; failed: number }> => {
	const base = { organization_id: ctx.organization._id, location_id: { $in: toIds(locationIds) }, archived_at: null };
	const [ready, failed, scheduled] = await Promise.all([
		Report.countDocuments({ ...base, status: 'ready' }),
		Report.countDocuments({ ...base, status: 'failed' }),
		ReportSchedule.countDocuments({ ...scheduleScope(ctx), status: 'active' }),
	]);
	return { ready, scheduled, failed };
};
