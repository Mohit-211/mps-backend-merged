import { CompetitorRow, EMPTY_FACTS, scoreRow } from '../../../src/gbp/report/competitors';
import { gapInsights } from '../../../src/gbp/report/insights';

const NOW = new Date('2026-09-26T12:00:00Z');

const row = (placeId: string, isSelf: boolean, facts: Partial<CompetitorRow>, ranks: number[] | null = null): CompetitorRow => {
	const mapList = ranks ? ranks.map((r, i) => ({ keyword: `k${i}`, results: [{ rank: r, place_id: placeId, is_self: isSelf }] })) : [];
	return scoreRow(
		{ place_id: placeId, is_self: isSelf, source: isSelf ? 'self' : 'tracking', ...EMPTY_FACTS, has_hours: true, has_website: true, has_phone: true, fetched_at: NOW, stale: false, error: null, ...facts },
		mapList,
	);
};

describe('gapInsights', () => {
	it('review, rating, basics, rank and category gaps, highest impact first, max 5', () => {
		const self = row('S', true, { name: 'Me', rating: 4.1, user_rating_count: 20, has_hours: false, has_website: false, primary_type: 'plumber', primary_type_label: 'Plumber' }, [12, 15]);
		const a = row('A', false, { name: 'Alpha', rating: 4.8, user_rating_count: 300, primary_type: 'drainage_service', primary_type_label: 'Drainage service' }, [1, 2]);
		const b = row('B', false, { name: 'Beta', rating: 4.5, user_rating_count: 60, primary_type: 'drainage_service', primary_type_label: 'Drainage service' }, [3, 4]);
		const insights = gapInsights([self, a, b]);
		expect(insights.length).toBe(5);
		expect(insights.map((i) => i.id)).toEqual(expect.arrayContaining(['review_gap', 'rating_gap', 'rank_gap']));
		const impacts = insights.map((i) => i.impact);
		expect([...impacts].sort((x, y) => y - x)).toEqual(impacts);
		const review = insights.find((i) => i.id === 'review_gap');
		expect(review).toMatchObject({ place_id: 'A' });
		expect(review?.message).toContain('Alpha has 300 reviews; you have 20 (15×');
	});

	it('the category rule fires when most competitors share another primary type', () => {
		const self = row('S', true, { rating: 4.9, user_rating_count: 500, primary_type: 'plumber' });
		const others = ['A', 'B', 'C'].map((id) => row(id, false, { rating: 4.0, user_rating_count: 10, primary_type: 'drainage_service', primary_type_label: 'Drainage service' }));
		expect(gapInsights([self, ...others]).map((i) => i.id)).toEqual(['category_mismatch']);
	});

	it('nothing without a fetched client row or competitors; closed competitors are ignored', () => {
		expect(gapInsights([row('S', true, {})])).toEqual([]);
		expect(gapInsights([row('S', true, { fetched_at: null }), row('A', false, { user_rating_count: 999 })])).toEqual([]);
		const closed = row('A', false, { user_rating_count: 999, business_status: 'CLOSED_PERMANENTLY' });
		expect(gapInsights([row('S', true, { user_rating_count: 1 }), closed])).toEqual([]);
	});
});
