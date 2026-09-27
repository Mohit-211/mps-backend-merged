import { MAX_RANK } from './rankCell';
import { RankCell } from './types';

// Repeated sampling (Phase 12.5). A point is searched N times; its rank is the median of the samples.
// - not_found counts as 61 (MAX_RANK + 1); errored samples are left out.
// - More than half the samples errored → the cell is an error.
// - Even count: the mean of the two middle values, rounded up (the conservative, worse rank).
// - A median of 61 is not_found.

export const NOT_FOUND_VALUE = MAX_RANK + 1;

export interface SampledCell extends RankCell {
	/** One value per sample: 1–60, 61 = not found, null = the search failed. */
	samples: (number | null)[];
	/** max − min over the non-error samples; null with fewer than 2 of them. */
	spread: number | null;
}

const valueOf = (cell: RankCell): number | null => (cell.status === 'error' ? null : cell.status === 'not_found' || cell.rank === null ? NOT_FOUND_VALUE : cell.rank);

export const medianRank = (values: number[]): number => {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid] : Math.ceil((sorted[mid - 1] + sorted[mid]) / 2);
};

export const aggregateSamples = (cells: RankCell[]): SampledCell => {
	if (cells.length === 0) throw new Error('aggregateSamples needs at least one sample');
	const samples = cells.map(valueOf);
	const values = samples.filter((v): v is number => v !== null);
	const spread = values.length >= 2 ? Math.max(...values) - Math.min(...values) : null;
	const errors = samples.length - values.length;
	if (values.length === 0 || errors > samples.length / 2) return { rank: null, status: 'error', samples, spread };
	const median = medianRank(values);
	return median > MAX_RANK ? { rank: null, status: 'not_found', samples, spread } : { rank: median, status: 'ok', samples, spread };
};
