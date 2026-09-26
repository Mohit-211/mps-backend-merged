import { DateTime } from 'luxon';
import { GBP_SCORE } from '../scoring.config';

// Performance section of the GBP report (Phase 7c), pure. Daily metric rows are aggregated per
// range (28 d, 90 d, 12 m = 365 d). The window ends at the latest date with data (Google's data
// lags a few days). Missing days count as 0, and each period reports its day coverage; a change is
// null when either period has less than GBP_SCORE.minCoverage of its days with data.

export const REPORT_RANGES = ['28d', '90d', '12m'] as const;
export type ReportRange = (typeof REPORT_RANGES)[number];
export const RANGE_DAYS: Record<ReportRange, number> = { '28d': 28, '90d': 90, '12m': 365 };

export interface MetricRow {
	date: string;
	metric: string;
	value: number;
}

export interface PeriodTotals {
	impressions: number;
	maps: number;
	search: number;
	mobile: number;
	desktop: number;
	calls: number;
	website_clicks: number;
	direction_requests: number;
	conversations: number;
	bookings: number;
	food_orders: number;
	food_menu_clicks: number;
	/** calls + website clicks + direction requests + conversations + bookings + food orders + food-menu clicks. */
	actions: number;
}

export interface Coverage {
	days_with_data: number;
	days: number;
}

export interface Period {
	start: string;
	end: string;
	totals: PeriodTotals;
	coverage: Coverage;
}

export interface ComparedPeriod extends Period {
	/** Fractional change of the current period vs this one (0.12 = +12 %); null when not comparable. */
	change: Record<keyof PeriodTotals, number | null>;
}

export interface DayRow {
	date: string;
	impressions: number;
	maps: number;
	search: number;
	actions: number;
	calls: number;
	website_clicks: number;
	direction_requests: number;
}

export interface PerformanceRange extends Period {
	range: ReportRange;
	days: number;
	previous_period: ComparedPeriod;
	same_period_last_year: ComparedPeriod;
	by_day: DayRow[];
	by_surface: { maps: number; search: number };
	by_device: { mobile: number; desktop: number };
	actions_per_1000_impressions: number | null;
	/** Change of actions per 1,000 impressions vs the previous period (fraction); null when not comparable. */
	actions_per_1000_change: number | null;
}

export interface PerformanceSection { available: true; latest_date: string; ranges: Record<ReportRange, PerformanceRange> }

const IMPRESSIONS: Record<string, { surface: 'maps' | 'search'; device: 'mobile' | 'desktop' }> = {
	BUSINESS_IMPRESSIONS_DESKTOP_MAPS: { surface: 'maps', device: 'desktop' },
	BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: { surface: 'search', device: 'desktop' },
	BUSINESS_IMPRESSIONS_MOBILE_MAPS: { surface: 'maps', device: 'mobile' },
	BUSINESS_IMPRESSIONS_MOBILE_SEARCH: { surface: 'search', device: 'mobile' },
};

const ACTIONS: Record<string, keyof PeriodTotals> = {
	CALL_CLICKS: 'calls',
	WEBSITE_CLICKS: 'website_clicks',
	BUSINESS_DIRECTION_REQUESTS: 'direction_requests',
	BUSINESS_CONVERSATIONS: 'conversations',
	BUSINESS_BOOKINGS: 'bookings',
	BUSINESS_FOOD_ORDERS: 'food_orders',
	BUSINESS_FOOD_MENU_CLICKS: 'food_menu_clicks',
};

const emptyTotals = (): PeriodTotals => ({
	impressions: 0,
	maps: 0,
	search: 0,
	mobile: 0,
	desktop: 0,
	calls: 0,
	website_clicks: 0,
	direction_requests: 0,
	conversations: 0,
	bookings: 0,
	food_orders: 0,
	food_menu_clicks: 0,
	actions: 0,
});

const addRow = (totals: PeriodTotals, row: MetricRow): void => {
	const imp = IMPRESSIONS[row.metric];
	if (imp) {
		totals.impressions += row.value;
		totals[imp.surface] += row.value;
		totals[imp.device] += row.value;
		return;
	}
	const action = ACTIONS[row.metric];
	if (action) {
		totals[action] += row.value;
		totals.actions += row.value;
	}
};

const round = (value: number, decimals: number): number => {
	const f = 10 ** decimals;
	return Math.round((value + Number.EPSILON) * f) / f;
};

const day = (iso: string): DateTime => DateTime.fromISO(iso, { zone: 'UTC' });
const isoOf = (d: DateTime): string => d.toISODate() as string;

/** Rows grouped by date, for repeated period sums. */
export const indexByDate = (rows: MetricRow[]): Map<string, MetricRow[]> => {
	const byDate = new Map<string, MetricRow[]>();
	for (const row of rows) {
		const list = byDate.get(row.date);
		if (list) list.push(row);
		else byDate.set(row.date, [row]);
	}
	return byDate;
};

const period = (byDate: Map<string, MetricRow[]>, start: DateTime, end: DateTime): Period => {
	const totals = emptyTotals();
	let withData = 0;
	let days = 0;
	for (let d = start; d <= end; d = d.plus({ days: 1 })) {
		days += 1;
		const rows = byDate.get(isoOf(d));
		if (!rows) continue;
		withData += 1;
		for (const row of rows) addRow(totals, row);
	}
	return { start: isoOf(start), end: isoOf(end), totals, coverage: { days_with_data: withData, days } };
};

export const comparable = (coverage: Coverage): boolean => coverage.days > 0 && coverage.days_with_data / coverage.days >= GBP_SCORE.minCoverage;

/** Fractional change; null when the base is 0 or either period lacks coverage. */
export const changeOf = (current: number, previous: number, ok: boolean): number | null => (!ok || previous === 0 ? null : round((current - previous) / previous, 3));

const per1000 = (totals: PeriodTotals): number | null => (totals.impressions > 0 ? round((totals.actions / totals.impressions) * 1000, 1) : null);

const compare = (current: Period, other: Period): ComparedPeriod => {
	const ok = comparable(current.coverage) && comparable(other.coverage);
	const change = {} as Record<keyof PeriodTotals, number | null>;
	for (const key of Object.keys(current.totals) as (keyof PeriodTotals)[]) change[key] = changeOf(current.totals[key], other.totals[key], ok);
	return { ...other, change };
};

export const performanceRange = (byDate: Map<string, MetricRow[]>, latest: string, range: ReportRange): PerformanceRange => {
	const days = RANGE_DAYS[range];
	const end = day(latest);
	const start = end.minus({ days: days - 1 });
	const current = period(byDate, start, end);
	const previous = compare(current, period(byDate, start.minus({ days }), start.minus({ days: 1 })));
	const lastYear = compare(current, period(byDate, start.minus({ years: 1 }), end.minus({ years: 1 })));
	const byDay: DayRow[] = [];
	for (let d = start; d <= end; d = d.plus({ days: 1 })) {
		const totals = emptyTotals();
		for (const row of byDate.get(isoOf(d)) ?? []) addRow(totals, row);
		byDay.push({
			date: isoOf(d),
			impressions: totals.impressions,
			maps: totals.maps,
			search: totals.search,
			actions: totals.actions,
			calls: totals.calls,
			website_clicks: totals.website_clicks,
			direction_requests: totals.direction_requests,
		});
	}
	const rate = per1000(current.totals);
	const previousRate = per1000(previous.totals);
	const ratesComparable = comparable(current.coverage) && comparable(previous.coverage);
	return {
		range,
		days,
		...current,
		previous_period: previous,
		same_period_last_year: lastYear,
		by_day: byDay,
		by_surface: { maps: current.totals.maps, search: current.totals.search },
		by_device: { mobile: current.totals.mobile, desktop: current.totals.desktop },
		actions_per_1000_impressions: rate,
		actions_per_1000_change: rate !== null && previousRate !== null ? changeOf(rate, previousRate, ratesComparable) : null,
	};
};

/** The performance section for every range, or null when there is no data at all. */
export const performanceSection = (rows: MetricRow[]): PerformanceSection | null => {
	if (rows.length === 0) return null;
	const latest = rows.reduce((max, r) => (r.date > max ? r.date : max), rows[0].date);
	const byDate = indexByDate(rows);
	const ranges = {} as Record<ReportRange, PerformanceRange>;
	for (const range of REPORT_RANGES) ranges[range] = performanceRange(byDate, latest, range);
	return { available: true, latest_date: latest, ranges };
};

/** The GBP Score's performance inputs (last 28 days vs the previous 28). */
export const scorePerformance = (section: PerformanceSection | null) => {
	if (!section) return null;
	const r = section.ranges['28d'];
	return {
		impressions_change: r.previous_period.change.impressions,
		actions_per_1000: comparable(r.coverage) ? r.actions_per_1000_impressions : null,
		actions_per_1000_change: r.actions_per_1000_change,
	};
};
