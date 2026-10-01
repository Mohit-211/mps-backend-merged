import { PublicInputs, computePublicScore } from '../../../src/gbp/score/publicScore';

const inputs = (over: Partial<PublicInputs> = {}): PublicInputs => ({
	rating: 4.8,
	user_rating_count: 250,
	primary_type: 'plumber',
	has_hours: true,
	has_website: true,
	has_phone: true,
	has_editorial_summary: true,
	business_status: 'OPERATIONAL',
	...over,
});

describe('computePublicScore', () => {
	it('perfect public data scores 100', () => {
		expect(computePublicScore(inputs()).score).toBe(100);
	});

	it('identical inputs give identical scores (self and competitor use one formula)', () => {
		const a = computePublicScore(inputs({ rating: 4.3, user_rating_count: 30 }));
		const b = computePublicScore(inputs({ rating: 4.3, user_rating_count: 30 }));
		expect(a).toEqual(b);
	});

	it('editorial summary not requested: that part is left out and the rest rescaled', () => {
		const r = computePublicScore(inputs({ has_editorial_summary: null }));
		expect(r.parts.find((p) => p.id === 'editorial_summary')?.available).toBe(false);
		expect(r.score).toBe(100);
		const missingWebsite = computePublicScore(inputs({ has_editorial_summary: null, has_website: false }));
		// 2026-10-02 (no rank parts): rating 25 + reviews 20 + 4 profile fields 20 = 65 available, website lost.
		expect(missingWebsite.score).toBe(Math.round((60 / 65) * 100));
	});

	it('missing rating and reviews score 0 for those parts; no rank parts since 2026-10-02', () => {
		const r = computePublicScore(inputs({ rating: null, user_rating_count: null }));
		expect(r.parts.find((p) => p.id === 'rating')?.points).toBe(0);
		expect(r.parts.map((p) => p.id)).toEqual(['rating', 'review_count', 'primary_category', 'hours', 'website', 'phone', 'editorial_summary']);
		expect(r.score).toBe(Math.round((25 / 70) * 100));
	});

	it('closed businesses score 0 with a flag', () => {
		expect(computePublicScore(inputs({ business_status: 'CLOSED_TEMPORARILY' }))).toMatchObject({ score: 0, flag: 'closed_temporarily' });
		expect(computePublicScore(inputs({ business_status: 'CLOSED_PERMANENTLY' }))).toMatchObject({ score: 0, flag: 'closed_permanently' });
	});
});
