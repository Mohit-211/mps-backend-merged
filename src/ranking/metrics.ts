import { MAX_RANK } from './rankCell';
import { Change, ChangeLabel, KeywordSummary, RankCell } from './types';

// Metrics and change calculation (CLAUDE.md §4). Error cells are excluded everywhere;
// not_found counts as 61 in averages.

export const NOT_FOUND_RANK_VALUE = MAX_RANK + 1;

const round = (value: number, decimals: number): number => {
	const factor = 10 ** decimals;
	return Math.round((value + Number.EPSILON) * factor) / factor;
};
export const round1 = (value: number): number => round(value, 1);
export const round2 = (value: number): number => round(value, 2);

const nonError = (cells: RankCell[]): RankCell[] => cells.filter((c) => c.status !== 'error');

/** Mean rank over non-error cells (not_found = 61), 1 decimal; null if every cell is an error. */
export const avgRank = (cells: RankCell[]): number | null => {
	const usable = nonError(cells);
	if (usable.length === 0) return null;
	const total = usable.reduce(
		(sum, c) => sum + (c.status === 'ok' && c.rank !== null ? c.rank : NOT_FOUND_RANK_VALUE),
		0,
	);
	return round1(total / usable.length);
};

/** Share of non-error cells where the target was found (rank 1–60), 2 decimals. */
export const foundRate = (cells: RankCell[]): number | null => {
	const usable = nonError(cells);
	if (usable.length === 0) return null;
	return round2(usable.filter((c) => c.status === 'ok').length / usable.length);
};

/** Share of non-error cells with rank ≤ 3, 2 decimals. */
export const top3Rate = (cells: RankCell[]): number | null => {
	const usable = nonError(cells);
	if (usable.length === 0) return null;
	return round2(usable.filter((c) => c.status === 'ok' && c.rank !== null && c.rank <= 3).length / usable.length);
};

export const summarise = (cells: RankCell[]): KeywordSummary => ({
	avgRank: avgRank(cells),
	foundRate: foundRate(cells),
	top3Rate: top3Rate(cells),
});

/** Unweighted mean of keyword avgRanks (nulls ignored), 1 decimal; null if none. */
export const overallAvgRank = (keywordAvgRanks: (number | null)[]): number | null => {
	const values = keywordAvgRanks.filter((v): v is number => v !== null);
	if (values.length === 0) return null;
	return round1(values.reduce((a, b) => a + b, 0) / values.length);
};

const labelFor = (change: number): ChangeLabel => {
	if (change > 0) return 'improved';
	if (change < 0) return 'declined';
	return 'unchanged';
};

const NO_CHANGE: Change = { change: null, changeLabel: null };

/**
 * Change of one cell between two runs with the same keyword set (§4):
 * both ok → previous − current; not_found → ok → entered_top_60; ok → not_found →
 * dropped_out_of_top_60; either side error (or both not_found) → no change.
 */
export const cellChange = (previous: RankCell | null | undefined, current: RankCell): Change => {
	if (!previous || previous.status === 'error' || current.status === 'error') return NO_CHANGE;
	if (previous.status === 'ok' && current.status === 'ok' && previous.rank !== null && current.rank !== null) {
		const change = previous.rank - current.rank;
		return { change, changeLabel: labelFor(change) };
	}
	if (previous.status === 'not_found' && current.status === 'ok') {
		return { change: null, changeLabel: 'entered_top_60' };
	}
	if (previous.status === 'ok' && current.status === 'not_found') {
		return { change: null, changeLabel: 'dropped_out_of_top_60' };
	}
	return NO_CHANGE;
};

/**
 * Change of a keyword summary between two runs with the same keyword set.
 * - no previous (or different keywords_version, passed as null) or an all-error side → no change
 * - not found at any point before, found now → entered_top_60
 * - found before, not found at any point now → dropped_out_of_top_60
 * - otherwise previous avgRank − current avgRank (1 decimal)
 */
export const keywordChange = (previous: KeywordSummary | null | undefined, current: KeywordSummary): Change => {
	if (!previous || previous.avgRank === null || current.avgRank === null) return NO_CHANGE;
	if (previous.foundRate === 0 && (current.foundRate ?? 0) > 0) {
		return { change: null, changeLabel: 'entered_top_60' };
	}
	if ((previous.foundRate ?? 0) > 0 && current.foundRate === 0) {
		return { change: null, changeLabel: 'dropped_out_of_top_60' };
	}
	const change = round1(previous.avgRank - current.avgRank);
	return { change, changeLabel: labelFor(change) };
};

/** Change of the overall average rank (previous − current, 1 decimal), or null. */
export const overallChange = (previous: number | null | undefined, current: number | null): number | null => {
	if (previous === null || previous === undefined || current === null) return null;
	return round1(previous - current);
};
