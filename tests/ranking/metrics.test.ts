import {
	avgRank,
	cellChange,
	foundRate,
	keywordChange,
	overallAvgRank,
	overallChange,
	summarise,
	top3Rate,
} from '../../src/ranking/metrics';
import { RankCell } from '../../src/ranking/types';

const ok = (rank: number): RankCell => ({ rank, status: 'ok' });
const NF: RankCell = { rank: null, status: 'not_found' };
const ERR: RankCell = { rank: null, status: 'error' };

describe('summary metrics', () => {
	it('all not_found → avgRank 61, foundRate 0, top3Rate 0', () => {
		expect(summarise([NF, NF, NF, NF, NF])).toEqual({ avgRank: 61, foundRate: 0, top3Rate: 0 });
	});

	it('all error → every metric null', () => {
		expect(summarise([ERR, ERR, ERR])).toEqual({ avgRank: null, foundRate: null, top3Rate: null });
	});

	it('empty input → every metric null', () => {
		expect(summarise([])).toEqual({ avgRank: null, foundRate: null, top3Rate: null });
	});

	it('mixed: errors excluded, not_found counted as 61', () => {
		// non-error cells: 2, 5, 61 (NF), 1 → mean 17.25 → 17.3; found 3/4; top3 2/4
		const cells = [ok(2), ERR, ok(5), NF, ok(1), ERR];
		expect(avgRank(cells)).toBe(17.3);
		expect(foundRate(cells)).toBe(0.75);
		expect(top3Rate(cells)).toBe(0.5);
	});

	it('rounds avgRank to 1 decimal and rates to 2 decimals', () => {
		const cells = [ok(1), ok(2), ok(4)]; // 7/3 = 2.333…; found 1; top3 2/3
		expect(summarise(cells)).toEqual({ avgRank: 2.3, foundRate: 1, top3Rate: 0.67 });
		expect(avgRank([ok(2), ok(3)])).toBe(2.5);
		expect(avgRank([ok(1), ok(2), ok(2), ok(4)])).toBe(2.3); // 2.25 → 2.3 (half up)
	});

	it('rank exactly 3 counts as top 3, rank 4 does not', () => {
		expect(top3Rate([ok(3), ok(4)])).toBe(0.5);
	});
});

describe('overallAvgRank', () => {
	it('is the unweighted mean of keyword averages, ignoring nulls', () => {
		expect(overallAvgRank([4.2, 61, null, 10.1])).toBe(25.1);
	});

	it('is null when no keyword has an average', () => {
		expect(overallAvgRank([null, null])).toBeNull();
		expect(overallAvgRank([])).toBeNull();
	});
});

describe('cellChange (§4 rules)', () => {
	it('both ok: previous − current, positive = improved', () => {
		expect(cellChange(ok(8), ok(3))).toEqual({ change: 5, changeLabel: 'improved' });
		expect(cellChange(ok(3), ok(8))).toEqual({ change: -5, changeLabel: 'declined' });
		expect(cellChange(ok(4), ok(4))).toEqual({ change: 0, changeLabel: 'unchanged' });
	});

	it('not_found → ok is entered_top_60 with no number', () => {
		expect(cellChange(NF, ok(12))).toEqual({ change: null, changeLabel: 'entered_top_60' });
	});

	it('ok → not_found is dropped_out_of_top_60 with no number', () => {
		expect(cellChange(ok(12), NF)).toEqual({ change: null, changeLabel: 'dropped_out_of_top_60' });
	});

	it('either side error → null', () => {
		expect(cellChange(ERR, ok(1))).toEqual({ change: null, changeLabel: null });
		expect(cellChange(ok(1), ERR)).toEqual({ change: null, changeLabel: null });
		expect(cellChange(ERR, NF)).toEqual({ change: null, changeLabel: null });
	});

	it('no previous run, or both not_found → null', () => {
		expect(cellChange(null, ok(1))).toEqual({ change: null, changeLabel: null });
		expect(cellChange(undefined, ok(1))).toEqual({ change: null, changeLabel: null });
		expect(cellChange(NF, NF)).toEqual({ change: null, changeLabel: null });
	});
});

describe('keywordChange', () => {
	const s = (avg: number | null, found: number | null, top3: number | null = 0) => ({
		avgRank: avg,
		foundRate: found,
		top3Rate: top3,
	});

	it('no comparable previous run (null / different keywords_version) → null', () => {
		expect(keywordChange(null, s(5, 1))).toEqual({ change: null, changeLabel: null });
	});

	it('all-error on either side → null', () => {
		expect(keywordChange(s(null, null), s(5, 1))).toEqual({ change: null, changeLabel: null });
		expect(keywordChange(s(5, 1), s(null, null))).toEqual({ change: null, changeLabel: null });
	});

	it('not found anywhere before, found now → entered_top_60', () => {
		expect(keywordChange(s(61, 0), s(40.2, 0.4))).toEqual({ change: null, changeLabel: 'entered_top_60' });
	});

	it('found before, not found anywhere now → dropped_out_of_top_60', () => {
		expect(keywordChange(s(30, 0.6), s(61, 0))).toEqual({ change: null, changeLabel: 'dropped_out_of_top_60' });
	});

	it('otherwise previous − current avgRank, 1 decimal', () => {
		expect(keywordChange(s(12.4, 1), s(9.1, 1))).toEqual({ change: 3.3, changeLabel: 'improved' });
		expect(keywordChange(s(9.1, 1), s(12.4, 1))).toEqual({ change: -3.3, changeLabel: 'declined' });
		expect(keywordChange(s(61, 0), s(61, 0))).toEqual({ change: 0, changeLabel: 'unchanged' });
	});
});

describe('overallChange', () => {
	it('is previous − current, 1 decimal, or null', () => {
		expect(overallChange(20.25, 15.1)).toBe(5.2);
		expect(overallChange(null, 15)).toBeNull();
		expect(overallChange(undefined, 15)).toBeNull();
		expect(overallChange(15, null)).toBeNull();
	});
});
