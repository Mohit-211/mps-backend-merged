// Reviews section of the GBP report and the review statistics the GBP Score uses (v4 data). Pure.

const DAY_MS = 86_400_000;
const UNREPLIED_LIMIT = 10;
const EXCERPT_CHARS = 200;

export interface ReviewInput {
	rating: number | null;
	comment: string | null;
	create_time: Date | null;
	reply: { comment: string; update_time: Date | null } | null;
	reviewer: { display_name: string | null; is_anonymous: boolean };
}

export interface ReviewStats {
	average_rating: number | null;
	total: number;
	new_30d: number;
	new_90d: number;
	/** Replied share of reviews from the last 90 days; null with no reviews in 90 days. */
	reply_rate_90d: number | null;
	/** Median hours from review to reply (replied reviews, last 90 days); null with no replies. */
	median_reply_hours: number | null;
}

export interface ReviewsSection extends ReviewStats {
	available: true;
	/** "YYYY-MM" → count, the last 12 months (oldest first). */
	per_month: { month: string; count: number; average_rating: number | null }[];
	/** Stars 1–5 → count. */
	distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
	unreplied: { rating: number | null; created_at: Date | null; excerpt: string | null; reviewer: string | null }[];
}

const round = (value: number, decimals: number): number => {
	const f = 10 ** decimals;
	return Math.round((value + Number.EPSILON) * f) / f;
};

export const median = (values: number[]): number | null => {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const within = (date: Date | null, now: Date, days: number): boolean =>
	date !== null && now.getTime() - date.getTime() <= days * DAY_MS && date.getTime() <= now.getTime();

/**
 * Review statistics. `summary` (Google's averageRating / totalReviewCount) wins over the stored
 * reviews when present, since the stored list can lag behind.
 */
export const reviewStats = (
	reviews: ReviewInput[],
	now: Date,
	summary: { average_rating: number | null; total: number | null } | null = null,
): ReviewStats => {
	const rated = reviews.filter((r) => typeof r.rating === 'number') as (ReviewInput & { rating: number })[];
	const ownAverage = rated.length ? round(rated.reduce((s, r) => s + r.rating, 0) / rated.length, 2) : null;
	const recent = reviews.filter((r) => within(r.create_time, now, 90));
	const replied = recent.filter((r) => r.reply !== null);
	const replyHours = replied
		.filter((r) => r.reply?.update_time && r.create_time)
		.map((r) => ((r.reply?.update_time as Date).getTime() - (r.create_time as Date).getTime()) / 3_600_000)
		.filter((h) => h >= 0);
	const medianHours = median(replyHours);
	return {
		average_rating: summary?.average_rating ?? ownAverage,
		total: summary?.total ?? reviews.length,
		new_30d: reviews.filter((r) => within(r.create_time, now, 30)).length,
		new_90d: recent.length,
		reply_rate_90d: recent.length ? round(replied.length / recent.length, 2) : null,
		median_reply_hours: medianHours === null ? null : round(medianHours, 1),
	};
};

const monthKey = (date: Date): string => date.toISOString().slice(0, 7);

const lastMonths = (now: Date, count: number): string[] => {
	const out: string[] = [];
	for (let i = count - 1; i >= 0; i -= 1) {
		out.push(monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
	}
	return out;
};

export const reviewsSection = (
	reviews: ReviewInput[],
	now: Date,
	summary: { average_rating: number | null; total: number | null } | null = null,
): ReviewsSection => {
	const months = lastMonths(now, 12);
	const perMonth = months.map((month) => {
		const inMonth = reviews.filter((r) => r.create_time && monthKey(r.create_time) === month);
		const rated = inMonth.filter((r) => typeof r.rating === 'number');
		return {
			month,
			count: inMonth.length,
			average_rating: rated.length ? round(rated.reduce((s, r) => s + (r.rating as number), 0) / rated.length, 2) : null,
		};
	});
	const distribution = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
	for (const r of reviews) {
		if (typeof r.rating === 'number' && r.rating >= 1 && r.rating <= 5) distribution[String(Math.round(r.rating)) as keyof typeof distribution] += 1;
	}
	const unreplied = reviews
		.filter((r) => r.reply === null)
		.sort((a, b) => (b.create_time?.getTime() ?? 0) - (a.create_time?.getTime() ?? 0))
		.slice(0, UNREPLIED_LIMIT)
		.map((r) => ({
			rating: r.rating,
			created_at: r.create_time,
			excerpt: r.comment ? (r.comment.length > EXCERPT_CHARS ? `${r.comment.slice(0, EXCERPT_CHARS - 1)}…` : r.comment) : null,
			reviewer: r.reviewer.is_anonymous ? null : r.reviewer.display_name,
		}));
	return { available: true, ...reviewStats(reviews, now, summary), per_month: perMonth, distribution, unreplied };
};
