import { CompetitorRow, EMPTY_FACTS, MapListSection, competitorSet, factsFromDetails, needsFetch, scoreRow } from '../../../src/gbp/report/competitors';

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
	it('facts from Place Details: editorial summary always (Atmosphere SKU), photo count capped at 10, reviews with author attribution', () => {
		const review = (days: number, name: string) => ({ rating: 5, text: 'Great', publishTime: new Date(Date.UTC(2026, 8, 20) - days * 86_400_000).toISOString(), relativeTime: `${days} days ago`, author: { name, uri: `https://maps.test/${name}` } });
		const details = {
			displayName: 'Queen West Plumbing', rating: 4.6, userRatingCount: 212, primaryType: 'plumber', primaryTypeDisplayName: 'Plumber',
			regularOpeningHours: { weekdayDescriptions: ['Mon: 8–5'] }, websiteUri: 'https://q.test', businessStatus: 'OPERATIONAL', editorialSummary: 'Family run',
			photoCount: 10, reviews: [review(30, 'Ann'), review(3, 'Bo')],
		};
		const facts = factsFromDetails(details);
		expect(facts).toMatchObject({ name: 'Queen West Plumbing', has_hours: true, has_website: true, has_phone: false, has_editorial_summary: true, photo_count: 10, photos_capped: true });
		expect(facts.reviews[1]).toMatchObject({ rating: 5, text: 'Great', relative_time: '3 days ago', author: { name: 'Bo', uri: 'https://maps.test/Bo' } });
		expect(facts.recent_review_at?.toISOString()).toBe(new Date(Date.UTC(2026, 8, 17)).toISOString());
		expect(factsFromDetails({ displayName: 'X' })).toMatchObject({ photo_count: 0, photos_capped: false, reviews: [], recent_review_at: null, has_editorial_summary: false });
	});

	it('a never-fetched row has no public score; a fetched one is scored (no rank data in the row since 2026-10-02)', () => {
		const empty = scoreRow({ place_id: 'B', is_self: false, source: 'tracking', ...EMPTY_FACTS, fetched_at: null, stale: true, error: 'x' });
		expect(empty.public_score).toBeNull();
		expect(empty).not.toHaveProperty('center_rank');
		const row: CompetitorRow = scoreRow({ place_id: 'B', is_self: false, source: 'tracking', ...EMPTY_FACTS, rating: 4.8, user_rating_count: 250, fetched_at: NOW, stale: false, error: null });
		expect(row.public_score?.score).toBeGreaterThan(0);
	});
});
