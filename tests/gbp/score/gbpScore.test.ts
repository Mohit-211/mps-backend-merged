import { GbpProfileSummary } from '../../../src/models/gbpData.model';
import { GbpScoreInput, computeGbpScore } from '../../../src/gbp/score/gbpScore';
import { gradeFor, maxBand, minBand } from '../../../src/gbp/scoring.config';

const NOW = new Date('2026-12-10T12:00:00Z'); // Christmas Eve/Day and New Year's Eve are within 60 days
const DAY = 86_400_000;

const profile = (over: Partial<GbpProfileSummary> = {}): GbpProfileSummary => ({
	title: 'Example Plumbing',
	description: 'x'.repeat(300),
	primary_category: 'Plumber',
	additional_categories: ['Drainage service'],
	regular_hours: [{ open_day: 'MONDAY', open_time: '08:00', close_day: 'MONDAY', close_time: '17:00' }],
	special_hour_dates: ['2026-12-24', '2026-12-25', '2026-12-31', '2027-01-01'],
	more_hours_types: [],
	primary_phone: '(214) 555-0100',
	additional_phones: [],
	website: 'https://example.test',
	service_area: { business_type: null, place_count: 0, region_code: null },
	labels: [],
	open_status: 'OPEN',
	service_items: 4,
	latlng: null,
	place_id: 'ChIJx',
	maps_uri: null,
	new_review_uri: null,
	...over,
});

const perfect = (over: Partial<GbpScoreInput> = {}): GbpScoreInput => ({
	now: NOW,
	country: 'US',
	profile: profile(),
	attributes_count: 8,
	pending_google_edits: { has_pending: false },
	verification: { has_voice_of_merchant: true },
	posts: { last_post_at: new Date(NOW.getTime() - 2 * DAY), last_90_days: 15 },
	media: { owner_count: 40, latest_owner_upload: new Date(NOW.getTime() - 5 * DAY) },
	reviews: { average_rating: 4.8, total: 150, new_30d: 6, new_90d: 15, reply_rate_90d: 0.9, median_reply_hours: 10 },
	ranking: { overall_avg_rank: 2.4, top3_rate: 0.7 },
	performance: { impressions_change: 0.15, actions_per_1000: 60, actions_per_1000_change: 0.2 },
	...over,
});

const check = (result: ReturnType<typeof computeGbpScore>, id: string) => result.checks.find((c) => c.id === id);

describe('computeGbpScore', () => {
	it('a perfect profile scores 100 / A with every pillar', () => {
		const r = computeGbpScore(perfect());
		expect(r).toMatchObject({ score: 100, grade: 'A', partial: false, excluded_pillars: [], top_fixes: [] });
		expect(r.pillars.map((p) => [p.id, p.score])).toEqual([
			['completeness', 25],
			['activity', 20],
			['reviews', 25],
			['visibility', 20],
			['engagement', 10],
		]);
	});

	it('v4 off: activity and reviews are excluded and the rest rescaled to 100 (partial)', () => {
		const r = computeGbpScore(perfect({ posts: null, media: null, reviews: null }));
		expect(r).toMatchObject({ score: 100, partial: true, excluded_pillars: ['activity', 'reviews'] });
		expect(check(r, 'recent_post')?.status).toBe('not_available');

		// Losing all of engagement (10 of the remaining 55) → 45/55 = 82.
		const weak = computeGbpScore(perfect({ posts: null, media: null, reviews: null, performance: { impressions_change: 0.15, actions_per_1000: 1, actions_per_1000_change: -0.5 } }));
		expect(weak.score).toBe(Math.round((45 / 55) * 100));
		expect(weak.grade).toBe('B');
	});

	it('not_available checks inside a pillar are left out of that pillar', () => {
		// No reviews in 90 days and no replies: those two checks drop, the other reviews checks rescale.
		const r = computeGbpScore(perfect({ reviews: { average_rating: 4.8, total: 150, new_30d: 0, new_90d: 0, reply_rate_90d: null, median_reply_hours: null } }));
		const reviews = r.pillars.find((p) => p.id === 'reviews');
		expect(reviews?.available_max).toBe(7 + 5 + 3 + 2);
		expect(reviews?.earned).toBe(7 + 5);
		expect(check(r, 'reply_rate_90d')?.status).toBe('not_available');
	});

	it('completeness details: description, special hours, attributes, edits, verification', () => {
		const r = computeGbpScore(
			perfect({
				profile: profile({ description: 'short', special_hour_dates: ['2026-12-25', '2026-12-24'] }),
				attributes_count: 2,
				pending_google_edits: { has_pending: true },
				verification: { has_voice_of_merchant: false },
			}),
		);
		expect(check(r, 'description')).toMatchObject({ points: 1, max: 3, value: 5 });
		expect(check(r, 'special_hours')).toMatchObject({ points: 1, value: '2/4' });
		expect(check(r, 'special_hours')?.detail).toContain("New Year's Eve");
		expect(check(r, 'attributes')).toMatchObject({ points: 1, max: 2 });
		expect(check(r, 'no_pending_edits')).toMatchObject({ points: 0, value: false });
		expect(check(r, 'verified')).toMatchObject({ points: 0 });
	});

	it('special hours are not_available when no holiday falls in the window, or the country is unknown', () => {
		const august = computeGbpScore(perfect({ now: new Date('2026-08-01T00:00:00Z') }));
		expect(check(august, 'special_hours')?.status).toBe('scored'); // Labor Day 2026-09-07 is within 60 days
		const july = computeGbpScore(perfect({ now: new Date('2026-07-06T00:00:00Z') }));
		expect(check(july, 'special_hours')?.status).toBe('not_available'); // Labor Day is 63 days away
		const quiet = computeGbpScore(perfect({ now: new Date('2026-02-01T00:00:00Z') }));
		expect(check(quiet, 'special_hours')?.status).toBe('not_available');
		expect(check(computeGbpScore(perfect({ country: null })), 'special_hours')?.status).toBe('not_available');
	});

	it('no synced profile: completeness checks are not_available, not failed', () => {
		const r = computeGbpScore(perfect({ profile: null, attributes_count: null, pending_google_edits: null, verification: null }));
		expect(r.excluded_pillars).toContain('completeness');
		expect(r.checks.filter((c) => c.pillar === 'completeness').every((c) => c.status === 'not_available')).toBe(true);
	});

	it('visibility and engagement without data are not_available', () => {
		const r = computeGbpScore(perfect({ ranking: null, performance: null }));
		expect(r.excluded_pillars).toEqual(['visibility', 'engagement']);
	});

	it('top fixes: lost points weighted by pillar share, at most 5, each with a hint', () => {
		const r = computeGbpScore(
			perfect({
				verification: { has_voice_of_merchant: false }, // completeness 5/25 of 25 → 5
				posts: { last_post_at: null, last_90_days: 0 }, // activity 11/20 of 20 → 11
				performance: { impressions_change: -0.5, actions_per_1000: 60, actions_per_1000_change: 0.2 }, // visibility 6/20 of 20 → 6
				profile: profile({ website: null }), // 2
			}),
		);
		// recent_post and impressions_trend both lose 6 weighted points: ties sort by id.
		expect(r.top_fixes.map((f) => f.id)).toEqual(['impressions_trend', 'recent_post', 'posts_per_month', 'verified', 'website']);
		expect(r.top_fixes.every((f) => typeof f.fix_hint === 'string')).toBe(true);
	});
});

describe('bands and grades', () => {
	it('min bands are inclusive at the edge', () => {
		const bands = [{ min: 4.7, points: 7 }, { min: 4.5, points: 6 }];
		expect(minBand(4.7, bands)).toBe(7);
		expect(minBand(4.69, bands)).toBe(6);
		expect(minBand(4.49, bands)).toBe(0);
	});

	it('max bands are inclusive at the edge', () => {
		const bands = [{ max: 3, points: 8 }, { max: 5, points: 7 }];
		expect(maxBand(3, bands)).toBe(8);
		expect(maxBand(3.1, bands)).toBe(7);
		expect(maxBand(5.1, bands)).toBe(0);
	});

	it.each([
		[100, 'A'],
		[85, 'A'],
		[84, 'B'],
		[70, 'B'],
		[55, 'C'],
		[40, 'D'],
		[39, 'F'],
		[0, 'F'],
	])('%i → %s', (score, grade) => {
		expect(gradeFor(score)).toBe(grade);
	});
});
