import { PublicInputs, centerRank, computePublicScore } from '../../../src/gbp/score/publicScore';

const inputs = (over: Partial<PublicInputs> = {}): PublicInputs => ({
	rating: 4.8,
	user_rating_count: 250,
	primary_type: 'plumber',
	has_hours: true,
	has_website: true,
	has_phone: true,
	has_editorial_summary: true,
	business_status: 'OPERATIONAL',
	center_ranks: [1, 2, 3],
	...over,
});

describe('computePublicScore', () => {
	it('perfect public data scores 100', () => {
		expect(computePublicScore(inputs()).score).toBe(100);
	});

	it('identical inputs give identical scores (self and competitor use one formula)', () => {
		const a = computePublicScore(inputs({ rating: 4.3, user_rating_count: 30, center_ranks: [4, null, 12] }));
		const b = computePublicScore(inputs({ rating: 4.3, user_rating_count: 30, center_ranks: [4, null, 12] }));
		expect(a).toEqual(b);
	});

	it('editorial summary not requested: that part is left out and the rest rescaled', () => {
		const r = computePublicScore(inputs({ has_editorial_summary: null }));
		expect(r.parts.find((p) => p.id === 'editorial_summary')?.available).toBe(false);
		expect(r.score).toBe(100);
		const missingWebsite = computePublicScore(inputs({ has_editorial_summary: null, has_website: false }));
		expect(missingWebsite.score).toBe(Math.round((90 / 95) * 100));
	});

	it('missing rating and reviews score 0 for those parts; no map-list data leaves rank parts out', () => {
		const r = computePublicScore(inputs({ rating: null, user_rating_count: null, center_ranks: [] }));
		expect(r.parts.find((p) => p.id === 'rating')?.points).toBe(0);
		expect(r.parts.find((p) => p.id === 'center_rank')?.available).toBe(false);
		expect(r.score).toBe(Math.round((25 / 70) * 100));
	});

	it('closed businesses score 0 with a flag', () => {
		expect(computePublicScore(inputs({ business_status: 'CLOSED_TEMPORARILY' }))).toMatchObject({ score: 0, flag: 'closed_temporarily' });
		expect(computePublicScore(inputs({ business_status: 'CLOSED_PERMANENTLY' }))).toMatchObject({ score: 0, flag: 'closed_permanently' });
	});
});

describe('centerRank', () => {
	it('averages with 21 for keywords outside the top 20', () => {
		expect(centerRank([1, null, 5])).toEqual({ avg: 9, top3_rate: 0.33, keywords_found: 2, keywords: 3 });
		expect(centerRank([])).toEqual({ avg: null, top3_rate: null, keywords_found: 0, keywords: 0 });
	});
});
