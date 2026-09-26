import { ReviewInput, median, reviewStats, reviewsSection } from '../../../src/gbp/report/reviews';

const NOW = new Date('2026-09-26T12:00:00Z');
const daysAgo = (d: number, h = 0) => new Date(NOW.getTime() - d * 86_400_000 + h * 3_600_000);
const review = (rating: number, created: Date, replyAfterHours: number | null, name = 'Pat'): ReviewInput => ({
	rating,
	comment: `Review ${rating}`,
	create_time: created,
	reply: replyAfterHours === null ? null : { comment: 'Thanks', update_time: new Date(created.getTime() + replyAfterHours * 3_600_000) },
	reviewer: { display_name: name, is_anonymous: false },
});

const reviews = [
	review(5, daysAgo(2), 10),
	review(4, daysAgo(20), 30),
	review(5, daysAgo(40), null),
	review(2, daysAgo(80), 100),
	review(5, daysAgo(200), 5),
];

describe('reviewStats', () => {
	it('counts, reply rate and median reply time over 90 days', () => {
		expect(reviewStats(reviews, NOW)).toEqual({
			average_rating: 4.2,
			total: 5,
			new_30d: 2,
			new_90d: 4,
			reply_rate_90d: 0.75,
			median_reply_hours: 30,
		});
	});

	it("Google's summary wins for average and total", () => {
		expect(reviewStats(reviews, NOW, { average_rating: 4.6, total: 88 })).toMatchObject({ average_rating: 4.6, total: 88 });
	});

	it('null reply stats without recent reviews or replies', () => {
		expect(reviewStats([review(5, daysAgo(200), null)], NOW)).toMatchObject({ reply_rate_90d: null, median_reply_hours: null });
	});

	it('median', () => {
		expect(median([])).toBeNull();
		expect(median([3, 1, 2])).toBe(2);
		expect(median([4, 1, 2, 3])).toBe(2.5);
	});
});

describe('reviewsSection', () => {
	it('12 months, distribution and unreplied (anonymous reviewers hidden)', () => {
		const s = reviewsSection([...reviews, { ...review(1, daysAgo(1), null), reviewer: { display_name: 'X', is_anonymous: true } }], NOW);
		expect(s.per_month).toHaveLength(12);
		expect(s.per_month[11]).toMatchObject({ month: '2026-09', count: 3 });
		expect(s.distribution).toEqual({ '1': 1, '2': 1, '3': 0, '4': 1, '5': 3 });
		expect(s.unreplied.map((u) => [u.rating, u.reviewer])).toEqual([
			[1, null],
			[5, 'Pat'],
		]);
	});
});
