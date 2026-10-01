import { CompetitorRow, EMPTY_FACTS, scoreRow } from '../../../src/gbp/report/competitors';
import { gapInsights } from '../../../src/gbp/report/insights';

const NOW = new Date('2026-09-26T12:00:00Z');

const row = (placeId: string, isSelf: boolean, facts: Partial<CompetitorRow>): CompetitorRow =>
	scoreRow({ place_id: placeId, is_self: isSelf, source: isSelf ? 'self' : 'tracking', ...EMPTY_FACTS, has_hours: true, has_website: true, has_phone: true, fetched_at: NOW, stale: false, error: null, ...facts });

describe('gapInsights', () => {
	it('review, rating, basics and category gaps, highest impact first, max 5; no rank gap since 2026-10-02', () => {
		const self = row('S', true, { name: 'Me', rating: 4.1, user_rating_count: 20, has_hours: false, has_website: false, primary_type: 'plumber', primary_type_label: 'Plumber' });
		const a = row('A', false, { name: 'Alpha', rating: 4.8, user_rating_count: 300, primary_type: 'drainage_service', primary_type_label: 'Drainage service' });
		const b = row('B', false, { name: 'Beta', rating: 4.5, user_rating_count: 60, primary_type: 'drainage_service', primary_type_label: 'Drainage service' });
		const insights = gapInsights([self, a, b]);
		expect(insights.length).toBe(5);
		expect(insights.map((i) => i.id)).toEqual(expect.arrayContaining(['review_gap', 'rating_gap', 'missing_hours']));
		expect(insights.map((i) => i.id)).not.toContain('rank_gap');
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

describe('gapInsights: Phase 12.5 photos and review freshness', () => {
	const DAY = 86_400_000;
	it('a competitor with 10+ photos when you show fewer', () => {
		const self = row('S', true, { photo_count: 3, photos_capped: false });
		const rival = row('A', false, { name: 'Rival', photo_count: 10, photos_capped: true });
		const i = gapInsights([self, rival]).find((x) => x.id === 'photos_gap');
		expect(i).toMatchObject({ place_id: 'A', message: expect.stringContaining('10+ photos') });
		expect(gapInsights([row('S', true, { photo_count: 10, photos_capped: true }), rival]).some((x) => x.id === 'photos_gap')).toBe(false);
		expect(gapInsights([row('S', true, {}), rival]).some((x) => x.id === 'photos_gap')).toBe(false); // not fetched yet
	});

	it('a competitor\'s latest review is 60+ days newer than yours', () => {
		const review = (daysAgo: number) => ({ rating: 5, text: 'x', publish_time: new Date(NOW.getTime() - daysAgo * DAY), relative_time: null, author: { name: 'A', uri: null } });
		const self = row('S', true, { photo_count: 10, photos_capped: true, reviews: [review(100)], recent_review_at: new Date(NOW.getTime() - 100 * DAY) });
		const rival = row('A', false, { name: 'Rival', reviews: [review(5)], recent_review_at: new Date(NOW.getTime() - 5 * DAY) });
		expect(gapInsights([self, rival]).find((x) => x.id === 'review_freshness')?.message).toContain('95 days newer');
		const close = row('S', true, { photo_count: 10, photos_capped: true, reviews: [review(20)], recent_review_at: new Date(NOW.getTime() - 20 * DAY) });
		expect(gapInsights([close, rival]).some((x) => x.id === 'review_freshness')).toBe(false);
	});
});
