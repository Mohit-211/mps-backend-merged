import {
	SheetRow,
	namesMatch,
	normaliseName,
	parseNames,
	parseRank,
	scoreSheet,
	top3Overlap,
} from '../../src/calibration/score';

let n = 0;
const row = (api_rank: string, manual_rank: string, extra: Partial<SheetRow> = {}): SheetRow => {
	n++;
	return {
		keyword: 'seo company',
		point_type: 'grid',
		row: String(n),
		col: '0',
		lat: String(45 + n / 100),
		lng: '-66.6',
		api_rank,
		api_top3: '',
		manual_rank,
		manual_top3: '',
		...extra,
	};
};

describe('parseRank', () => {
	it.each([
		['4', 4],
		['#7', 7],
		['60+', 'not_found'],
		['>60', 'not_found'],
		['Not Found', 'not_found'],
		['-', 'not_found'],
		['75', 'not_found'],
		['error', 'error'],
		['', null],
		[undefined, null],
		['abc', null],
		['0', null],
	])('%p → %p', (input, expected) => expect(parseRank(input)).toBe(expected));
});

describe('names', () => {
	it('normalises punctuation, & and legal suffixes', () => {
		expect(normaliseName('The Alpha & Omega SEO, Inc.')).toBe('alpha and omega seo');
	});
	it('splits on | or ; and keeps unknown markers', () => {
		expect(parseNames('Alpha SEO | Beta Ltd; (unknown: x1)')).toEqual(['alpha seo', 'beta', '(unknown: x1)']);
		expect(parseNames('')).toEqual([]);
	});
	it('matches equal names or containment of at least 4 chars', () => {
		expect(namesMatch('mypageseo', 'mypageseo digital')).toBe(true);
		expect(namesMatch('abc', 'abc seo')).toBe(false);
		expect(namesMatch('alpha', 'beta')).toBe(false);
	});
	it('scores top-3 overlap, or null when not comparable', () => {
		expect(top3Overlap(['a1a1', 'b2b2', 'c3c3'], ['c3c3', 'a1a1', 'zzzz'])).toBeCloseTo(2 / 3);
		expect(top3Overlap(['a1a1', 'b2b2'], ['a1a1', 'b2b2', 'c3c3'])).toBe(1);
		expect(top3Overlap(['a1a1', '(unknown: x)'], ['a1a1'])).toBeNull();
		expect(top3Overlap(['a1a1'], [])).toBeNull();
	});
});

describe('scoreSheet', () => {
	const top3 = { api_top3: 'Alpha | Bravo | Charlie', manual_top3: 'Alpha | Bravo | Delta' };

	it('PASSes when within-2 ≥ 70% and top-3 overlap ≥ 60%', () => {
		const s = scoreSheet([
			row('3', '3', top3),
			row('4', '6', top3), // gap 2: within
			row('60+', '60+', top3), // both not found: within
			row('5', '9', top3), // gap 4: not within
		]);
		expect(s.scored).toBe(4);
		expect(s.withinPct).toBe(75);
		expect(s.top3).toEqual({ rows: 4, overlapPct: 66.7 });
		expect(s.verdict).toBe('PASS');
		expect(s.reasons).toEqual([]);
	});

	it('FAILs on within-2 below 70% and reports found/not-found mismatches both ways', () => {
		const s = scoreSheet([row('1', '1', top3), row('60+', '5', top3), row('8', '60+', top3), row('2', '2', top3)]);
		expect(s.withinPct).toBe(50);
		expect(s.mapsFoundApiNotPct).toBe(25);
		expect(s.apiFoundMapsNotPct).toBe(25);
		expect(s.verdict).toBe('FAIL');
		expect(s.reasons[0]).toMatch(/within-2 is 50%/);
	});

	it('FAILs when top-3 overlap is low even if ranks agree', () => {
		const s = scoreSheet([row('1', '1', { api_top3: 'Alpha | Bravo | Charlie', manual_top3: 'Xray | Yankee | Zulu' })]);
		expect(s.withinPct).toBe(100);
		expect(s.top3.overlapPct).toBe(0);
		expect(s.verdict).toBe('FAIL');
	});

	it('FAILs with a reason when nothing is comparable', () => {
		const s = scoreSheet([row('1', '')]);
		expect(s.scored).toBe(0);
		expect(s.withinPct).toBeNull();
		expect(s.verdict).toBe('FAIL');
		expect(s.reasons).toHaveLength(2);
	});

	it('skips rows without a manual rank, API errors, and the duplicate center point', () => {
		const center = { lat: '45.963600', lng: '-66.643100' };
		const s = scoreSheet([
			row('2', '2', { ...center, point_type: 'tracker', row: 'C' }),
			row('2', '2', { ...center }), // grid center = same search
			row('error', '4'),
			row('3', ''),
		]);
		expect(s.scored).toBe(1);
		expect(s.skipped).toEqual({ noManual: 1, apiError: 1, duplicate: 1 });
	});

	it('skips top-3 rows with unnamed API places', () => {
		const s = scoreSheet([row('1', '1', { api_top3: 'Alpha | (unknown: p9)', manual_top3: 'Alpha | Bravo' })]);
		expect(s.top3.rows).toBe(0);
	});

	it('lists the 5 worst rows by gap, treating not found as 61', () => {
		const s = scoreSheet([
			row('1', '2'),
			row('60+', '1'), // gap 60
			row('3', '13'), // gap 10
			row('4', '4'), // gap 0: not listed
			row('5', '8'),
			row('10', '30'), // gap 20
			row('2', '6'),
			row('7', '9'),
		]);
		expect(s.worst.map((w) => w.gap)).toEqual([60, 20, 10, 4, 3]);
		expect(s.worst[0]).toMatchObject({ api_rank: '60+', manual_rank: '1' });
	});
});
