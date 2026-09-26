import { CompetitorRow, EMPTY_FACTS, MapListSection, centerRanksFor, competitorSet, factsFromDetails, needsFetch, scoreRow } from '../../../src/gbp/report/competitors';

const NOW = new Date('2026-09-26T12:00:00Z');
const H = 3_600_000;

const mapList: MapListSection[] = [
	{
		keyword: 'plumber',
		results: [
			{ rank: 1, place_id: 'A', is_self: false },
			{ rank: 2, place_id: 'SELF_MOVED', is_self: true },
			{ rank: 3, place_id: 'B', is_self: false },
			{ rank: 4, place_id: 'C', is_self: false },
			{ rank: 5, place_id: 'D', is_self: false },
		],
	},
	{ keyword: 'drain', results: [{ rank: 1, place_id: 'B', is_self: false }] },
];

describe('competitorSet', () => {
	it('self, then tracking competitors, then the top 3 non-client map-list results, de-duplicated', () => {
		expect(competitorSet('SELF', ['B', 'X'], mapList)).toEqual([
			{ place_id: 'SELF', source: 'self' },
			{ place_id: 'B', source: 'tracking' },
			{ place_id: 'X', source: 'tracking' },
			{ place_id: 'A', source: 'map_list' },
			{ place_id: 'C', source: 'map_list' },
			{ place_id: 'D', source: 'map_list' },
		]);
	});

	it('at most 5 competitors besides the client', () => {
		const refs = competitorSet('SELF', ['T1', 'T2', 'T3', 'T4'], mapList);
		expect(refs.filter((r) => r.source !== 'self')).toHaveLength(5);
		expect(refs.map((r) => r.place_id)).toEqual(['SELF', 'T1', 'T2', 'T3', 'T4', 'A']);
	});

	it('works without a map list', () => {
		expect(competitorSet('SELF', [], [])).toEqual([{ place_id: 'SELF', source: 'self' }]);
	});
});

describe('centerRanksFor', () => {
	it('matches the client by is_self (moved place IDs) and competitors by place_id', () => {
		expect(centerRanksFor('SELF', true, mapList)).toEqual([2, null]);
		expect(centerRanksFor('B', false, mapList)).toEqual([3, 1]);
		expect(centerRanksFor('Z', false, mapList)).toEqual([null, null]);
	});
});

describe('needsFetch', () => {
	const base = { now: NOW, cycle_start: null, force_at: null };
	it('fetches missing rows', () => {
		expect(needsFetch(undefined, base)).toBe(true);
		expect(needsFetch({ fetched_at: null }, base)).toBe(true);
	});

	it('once per monthly cycle', () => {
		const cycle = new Date(NOW.getTime() - 10 * 24 * H);
		expect(needsFetch({ fetched_at: new Date(cycle.getTime() - H) }, { ...base, cycle_start: cycle })).toBe(true);
		expect(needsFetch({ fetched_at: new Date(cycle.getTime() + H) }, { ...base, cycle_start: cycle })).toBe(false);
	});

	it('manual_only locations (no cycle) never refetch by themselves', () => {
		expect(needsFetch({ fetched_at: new Date(NOW.getTime() - 90 * 24 * H) }, base)).toBe(false);
	});

	it('a manual refresh forces rows older than 24 h only', () => {
		const force = new Date(NOW.getTime() - H);
		expect(needsFetch({ fetched_at: new Date(NOW.getTime() - 25 * H) }, { ...base, force_at: force })).toBe(true);
		expect(needsFetch({ fetched_at: new Date(NOW.getTime() - 5 * H) }, { ...base, force_at: force })).toBe(false);
		// Already refetched after the force: no second fetch.
		expect(needsFetch({ fetched_at: new Date(force.getTime() + 60_000) }, { ...base, force_at: force, now: new Date(NOW.getTime() + 48 * H) })).toBe(false);
	});
});

describe('rows', () => {
	it('facts from Place Details (editorial summary only when requested)', () => {
		const details = { displayName: 'Queen West Plumbing', rating: 4.6, userRatingCount: 212, primaryType: 'plumber', primaryTypeDisplayName: 'Plumber', regularOpeningHours: { weekdayDescriptions: ['Mon: 8–5'] }, websiteUri: 'https://q.test', businessStatus: 'OPERATIONAL', editorialSummary: 'Family run' };
		expect(factsFromDetails(details, false)).toMatchObject({ name: 'Queen West Plumbing', has_hours: true, has_website: true, has_phone: false, has_editorial_summary: null });
		expect(factsFromDetails(details, true).has_editorial_summary).toBe(true);
	});

	it('a never-fetched row has no public score; a fetched one is scored with its center ranks', () => {
		const empty = scoreRow({ place_id: 'B', is_self: false, source: 'tracking', ...EMPTY_FACTS, fetched_at: null, stale: true, error: 'x' }, mapList);
		expect(empty.public_score).toBeNull();
		expect(empty.center_rank).toMatchObject({ avg: 2, keywords_found: 2 });
		const row: CompetitorRow = scoreRow({ place_id: 'B', is_self: false, source: 'tracking', ...EMPTY_FACTS, rating: 4.8, user_rating_count: 250, fetched_at: NOW, stale: false, error: null }, mapList);
		expect(row.public_score?.score).toBeGreaterThan(0);
	});
});
