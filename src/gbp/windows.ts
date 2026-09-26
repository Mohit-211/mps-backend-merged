import { DateTime } from 'luxon';
import { DateRange } from '../clients/types/gbp';

// GBP sync date windows (Phase 7b), pure. Dates are UTC calendar dates.
// - Daily performance: the first sync backfills BACKFILL months; later (monthly) syncs fetch a
//   rolling window of ROLLING days (upserted, so overlaps are harmless and late data is corrected).
//   The window ends yesterday: today's numbers are incomplete.
// - Search keywords: the first sync fetches the last KEYWORD_BACKFILL complete months; later syncs
//   the last KEYWORD_ROLLING complete months. The current month is never included (incomplete).

export interface WindowSettings {
	backfillMonths: number;
	rollingDays: number;
	keywordBackfillMonths: number;
	keywordRollingMonths: number;
}

const ymd = (d: DateTime) => ({ year: d.year, month: d.month, day: d.day });

export const toIsoDate = (d: { year: number; month: number; day: number }): string =>
	`${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;

export const toIsoMonth = (m: { year: number; month: number }): string => `${m.year}-${String(m.month).padStart(2, '0')}`;

/** Inclusive date range for the daily metrics call. */
export const dailyWindow = (now: Date, backfill: boolean, settings: Pick<WindowSettings, 'backfillMonths' | 'rollingDays'>): DateRange => {
	const end = DateTime.fromJSDate(now, { zone: 'UTC' }).startOf('day').minus({ days: 1 });
	const start = backfill
		? end.minus({ months: settings.backfillMonths }).plus({ days: 1 })
		: end.minus({ days: settings.rollingDays - 1 });
	return { start: ymd(start), end: ymd(end) };
};

/** Complete months to fetch search keywords for, oldest first. */
export const keywordMonths = (
	now: Date,
	backfill: boolean,
	settings: Pick<WindowSettings, 'keywordBackfillMonths' | 'keywordRollingMonths'>,
): { year: number; month: number }[] => {
	const count = backfill ? settings.keywordBackfillMonths : settings.keywordRollingMonths;
	const lastComplete = DateTime.fromJSDate(now, { zone: 'UTC' }).startOf('month').minus({ months: 1 });
	return Array.from({ length: count }, (_, i) => lastComplete.minus({ months: count - 1 - i })).map((d) => ({ year: d.year, month: d.month }));
};
