import { GbpProfileSummary } from '../../models/gbpData.model';
import { ReviewStats } from '../report/reviews';
import { GBP_SCORE, PILLARS, PILLAR_WEIGHTS, PillarId, TOP_FIXES, gradeFor, maxBand, minBand } from '../scoring.config';
import { HolidayCountry, upcomingHolidays } from './holidays';

// GBP Score (Phase 7c): the client's private 0–100 score over 5 pillars. Pure.
// A check whose data doesn't exist is `not_available` and left out; a pillar with no available
// check is excluded, and the remaining pillars are rescaled to 100 (`partial: true`).

const DAY_MS = 86_400_000;

export type CheckStatus = 'scored' | 'not_available';

export interface ScoreCheck {
	id: string;
	pillar: PillarId;
	label: string;
	status: CheckStatus;
	value: number | string | boolean | null;
	points: number;
	max: number;
	detail: string;
	fix_hint: string | null;
}

export interface PillarResult {
	id: PillarId;
	weight: number;
	available: boolean;
	/** Points earned out of the available checks' maximum. */
	earned: number;
	available_max: number;
	/** The pillar's share of its weight (earned / available_max × weight), 1 decimal; null if excluded. */
	score: number | null;
}

export interface GbpScoreResult {
	available: true;
	score: number;
	grade: ReturnType<typeof gradeFor>;
	partial: boolean;
	excluded_pillars: PillarId[];
	pillars: PillarResult[];
	checks: ScoreCheck[];
	top_fixes: ScoreCheck[];
}

export interface GbpScoreInput {
	now: Date;
	country: HolidayCountry | null;
	profile: GbpProfileSummary | null;
	attributes_count: number | null;
	pending_google_edits: { has_pending: boolean } | null;
	verification: { has_voice_of_merchant: boolean } | null;
	/** null = not available (v4 off or not synced). */
	posts: { last_post_at: Date | null; last_90_days: number } | null;
	media: { owner_count: number; latest_owner_upload: Date | null } | null;
	reviews: ReviewStats | null;
	/** From the latest done/partial rank run (the client's own target). */
	ranking: { overall_avg_rank: number | null; top3_rate: number | null } | null;
	/** From the last 28 days of performance; changes are fractions (0.1 = +10 %), null without enough coverage. */
	performance: { impressions_change: number | null; actions_per_1000: number | null; actions_per_1000_change: number | null } | null;
}

const round1 = (v: number): number => Math.round((v + Number.EPSILON) * 10) / 10;
const pct = (fraction: number): string => `${fraction >= 0 ? '+' : ''}${Math.round(fraction * 100)} %`;

const scored = (pillar: PillarId, id: string, label: string, points: number, max: number, value: ScoreCheck['value'], detail: string, fix: string): ScoreCheck => ({
	id,
	pillar,
	label,
	status: 'scored',
	value,
	points,
	max,
	detail,
	fix_hint: points < max ? fix : null,
});

const notAvailable = (pillar: PillarId, id: string, label: string, max: number, detail: string): ScoreCheck => ({
	id,
	pillar,
	label,
	status: 'not_available',
	value: null,
	points: 0,
	max,
	detail,
	fix_hint: null,
});

const completenessChecks = (input: GbpScoreInput): ScoreCheck[] => {
	const c = GBP_SCORE.completeness;
	const p: PillarId = 'completeness';
	const profile = input.profile;
	const checks: ScoreCheck[] = [];
	const na = (id: string, label: string, max: number) => notAvailable(p, id, label, max, 'Profile data not synced yet.');

	if (input.verification) {
		const ok = input.verification.has_voice_of_merchant;
		checks.push(scored(p, 'verified', 'Profile verified', ok ? c.verified : 0, c.verified, ok, ok ? 'Verified: you can manage the profile.' : 'Not verified (no Voice of Merchant).', 'Complete Google verification for the profile.'));
	} else checks.push(na('verified', 'Profile verified', c.verified));

	if (!profile) {
		checks.push(
			na('description', 'Description', c.description.max),
			na('additional_categories', 'Additional categories', c.additionalCategories),
			na('regular_hours', 'Regular hours', c.regularHours),
			na('special_hours', 'Holiday hours', c.specialHours.max),
			na('website', 'Website', c.website),
			na('phone', 'Phone number', c.phone),
			na('service_items', 'Services listed', c.serviceItems),
		);
	} else {
		const len = profile.description?.trim().length ?? 0;
		const descPoints = len >= c.description.fullChars ? c.description.max : len > 0 ? c.description.partialPoints : 0;
		checks.push(scored(p, 'description', 'Description', descPoints, c.description.max, len, `${len} characters.`, `Write a description of at least ${c.description.fullChars} characters (services, area, what makes you different).`));

		const extra = profile.additional_categories.length;
		checks.push(scored(p, 'additional_categories', 'Additional categories', extra > 0 ? c.additionalCategories : 0, c.additionalCategories, extra, `${extra} additional categor${extra === 1 ? 'y' : 'ies'}.`, 'Add the additional categories that match your services.'));

		const hours = profile.regular_hours.length > 0;
		checks.push(scored(p, 'regular_hours', 'Regular hours', hours ? c.regularHours : 0, c.regularHours, hours, hours ? 'Opening hours are set.' : 'No opening hours.', 'Set your regular opening hours.'));

		if (!input.country) {
			checks.push(notAvailable(p, 'special_hours', 'Holiday hours', c.specialHours.max, 'Country unknown.'));
		} else {
			const holidays = upcomingHolidays(input.country, input.now, c.specialHours.windowDays);
			if (holidays.length === 0) {
				checks.push(notAvailable(p, 'special_hours', 'Holiday hours', c.specialHours.max, `No holidays in the next ${c.specialHours.windowDays} days.`));
			} else {
				const set = new Set(profile.special_hour_dates);
				const covered = holidays.filter((h) => set.has(h.date));
				const missing = holidays.filter((h) => !set.has(h.date)).map((h) => h.name);
				const points = covered.length === holidays.length ? c.specialHours.max : covered.length * 2 >= holidays.length ? 1 : 0;
				checks.push(
					scored(p, 'special_hours', 'Holiday hours', points, c.specialHours.max, `${covered.length}/${holidays.length}`, missing.length ? `Missing: ${missing.join(', ')}.` : 'Set for every upcoming holiday.', `Set special hours for ${missing.join(', ')}.`),
				);
			}
		}

		const site = Boolean(profile.website);
		checks.push(scored(p, 'website', 'Website', site ? c.website : 0, c.website, site, site ? 'Website set.' : 'No website.', 'Add your website.'));
		const phone = Boolean(profile.primary_phone);
		checks.push(scored(p, 'phone', 'Phone number', phone ? c.phone : 0, c.phone, phone, phone ? 'Phone set.' : 'No phone number.', 'Add a primary phone number.'));

		const services = profile.service_items;
		checks.push(scored(p, 'service_items', 'Services listed', services > 0 ? c.serviceItems : 0, c.serviceItems, services, `${services} service item${services === 1 ? '' : 's'}.`, 'List your services on the profile.'));
	}

	if (input.attributes_count === null) checks.push(na('attributes', 'Attributes', c.attributes.max));
	else {
		const n = input.attributes_count;
		checks.push(scored(p, 'attributes', 'Attributes', n >= c.attributes.min ? c.attributes.max : n > 0 ? 1 : 0, c.attributes.max, n, `${n} attributes set.`, `Set at least ${c.attributes.min} attributes (payments, accessibility, amenities…).`));
	}

	if (input.pending_google_edits === null) checks.push(na('no_pending_edits', 'No pending Google edits', c.noPendingEdits));
	else {
		const pending = input.pending_google_edits.has_pending;
		checks.push(scored(p, 'no_pending_edits', 'No pending Google edits', pending ? 0 : c.noPendingEdits, c.noPendingEdits, !pending, pending ? 'Google has suggested edits waiting for review.' : 'No pending edits.', 'Review the edits Google suggested in your Business Profile.'));
	}
	return checks;
};

const activityChecks = (input: GbpScoreInput): ScoreCheck[] => {
	const a = GBP_SCORE.activity;
	const p: PillarId = 'activity';
	const v4 = 'Needs Google My Business v4 access.';
	const checks: ScoreCheck[] = [];
	if (!input.posts) {
		checks.push(notAvailable(p, 'recent_post', `Post in the last ${a.recentPost.days} days`, a.recentPost.max, v4), notAvailable(p, 'posts_per_month', 'Posts per month', a.postsPerMonth.max, v4));
	} else {
		const last = input.posts.last_post_at;
		const days = last ? Math.floor((input.now.getTime() - last.getTime()) / DAY_MS) : null;
		const recent = days !== null && days <= a.recentPost.days;
		checks.push(scored(p, 'recent_post', `Post in the last ${a.recentPost.days} days`, recent ? a.recentPost.max : 0, a.recentPost.max, days, days === null ? 'No posts yet.' : `Last post ${days} days ago.`, 'Publish a post (offer, update or event) every week.'));
		const perMonth = round1(input.posts.last_90_days / 3);
		checks.push(scored(p, 'posts_per_month', 'Posts per month', minBand(perMonth, a.postsPerMonth.bands), a.postsPerMonth.max, perMonth, `${perMonth} per month over 90 days.`, 'Post at least 4 times a month.'));
	}
	if (!input.media) {
		checks.push(notAvailable(p, 'recent_owner_photo', `Photo in the last ${a.recentOwnerPhoto.days} days`, a.recentOwnerPhoto.max, v4), notAvailable(p, 'owner_photos', 'Owner photos', a.ownerPhotos.max, v4));
	} else {
		const last = input.media.latest_owner_upload;
		const days = last ? Math.floor((input.now.getTime() - last.getTime()) / DAY_MS) : null;
		const recent = days !== null && days <= a.recentOwnerPhoto.days;
		checks.push(scored(p, 'recent_owner_photo', `Photo in the last ${a.recentOwnerPhoto.days} days`, recent ? a.recentOwnerPhoto.max : 0, a.recentOwnerPhoto.max, days, days === null ? 'No owner photos yet.' : `Last photo ${days} days ago.`, 'Upload new photos every month.'));
		const n = input.media.owner_count;
		checks.push(scored(p, 'owner_photos', 'Owner photos', minBand(n, a.ownerPhotos.bands), a.ownerPhotos.max, n, `${n} owner photos.`, 'Upload at least 20 photos (exterior, interior, team, work).'));
	}
	return checks;
};

const reviewChecks = (input: GbpScoreInput): ScoreCheck[] => {
	const r = GBP_SCORE.reviews;
	const p: PillarId = 'reviews';
	const s = input.reviews;
	if (!s) {
		const v4 = 'Needs Google My Business v4 access.';
		return [
			notAvailable(p, 'average_rating', 'Average rating', r.averageRating.max, v4),
			notAvailable(p, 'review_count', 'Number of reviews', r.total.max, v4),
			notAvailable(p, 'new_reviews_30d', 'New reviews (30 days)', r.new30.max, v4),
			notAvailable(p, 'new_reviews_90d', 'New reviews (90 days)', r.new90.max, v4),
			notAvailable(p, 'reply_rate_90d', 'Reply rate (90 days)', r.replyRate90d.max, v4),
			notAvailable(p, 'median_reply_time', 'Reply time', r.medianReplyHours.max, v4),
		];
	}
	const checks: ScoreCheck[] = [];
	if (s.average_rating === null) checks.push(notAvailable(p, 'average_rating', 'Average rating', r.averageRating.max, 'No ratings yet.'));
	else checks.push(scored(p, 'average_rating', 'Average rating', minBand(s.average_rating, r.averageRating.bands), r.averageRating.max, s.average_rating, `${s.average_rating} stars.`, 'Ask happy customers for reviews and resolve complaints.'));
	checks.push(scored(p, 'review_count', 'Number of reviews', minBand(s.total, r.total.bands), r.total.max, s.total, `${s.total} reviews.`, 'Ask every satisfied customer for a review.'));
	checks.push(scored(p, 'new_reviews_30d', 'New reviews (30 days)', minBand(s.new_30d, r.new30.bands), r.new30.max, s.new_30d, `${s.new_30d} in the last 30 days.`, 'Aim for at least one new review a week.'));
	checks.push(scored(p, 'new_reviews_90d', 'New reviews (90 days)', minBand(s.new_90d, r.new90.bands), r.new90.max, s.new_90d, `${s.new_90d} in the last 90 days.`, 'Keep a steady flow of new reviews.'));
	if (s.reply_rate_90d === null) checks.push(notAvailable(p, 'reply_rate_90d', 'Reply rate (90 days)', r.replyRate90d.max, 'No reviews in the last 90 days.'));
	else checks.push(scored(p, 'reply_rate_90d', 'Reply rate (90 days)', minBand(s.reply_rate_90d, r.replyRate90d.bands), r.replyRate90d.max, s.reply_rate_90d, `${Math.round(s.reply_rate_90d * 100)} % replied.`, 'Reply to every review, good or bad.'));
	if (s.median_reply_hours === null) checks.push(notAvailable(p, 'median_reply_time', 'Reply time', r.medianReplyHours.max, 'No replies yet.'));
	else checks.push(scored(p, 'median_reply_time', 'Reply time', maxBand(s.median_reply_hours, r.medianReplyHours.bands), r.medianReplyHours.max, s.median_reply_hours, `Median ${s.median_reply_hours} h to reply.`, 'Reply within 24 hours.'));
	return checks;
};

const visibilityChecks = (input: GbpScoreInput): ScoreCheck[] => {
	const v = GBP_SCORE.visibility;
	const p: PillarId = 'visibility';
	const checks: ScoreCheck[] = [];
	const rank = input.ranking?.overall_avg_rank ?? null;
	if (rank === null) checks.push(notAvailable(p, 'map_rank', 'Average map rank', v.overallAvgRank.max, 'No completed rank run yet.'));
	else checks.push(scored(p, 'map_rank', 'Average map rank', maxBand(rank, v.overallAvgRank.bands), v.overallAvgRank.max, rank, `Average rank ${rank} across your keywords.`, 'Improve relevance and prominence for your keywords (categories, reviews, posts).'));
	const top3 = input.ranking?.top3_rate ?? null;
	if (top3 === null) checks.push(notAvailable(p, 'top3_rate', 'Top-3 rate', v.top3Rate.max, 'No completed rank run yet.'));
	else checks.push(scored(p, 'top3_rate', 'Top-3 rate', minBand(top3, v.top3Rate.bands), v.top3Rate.max, top3, `In the top 3 at ${Math.round(top3 * 100)} % of points.`, 'Target the keywords where you are just outside the top 3.'));
	const trend = input.performance?.impressions_change ?? null;
	if (trend === null) checks.push(notAvailable(p, 'impressions_trend', 'Impressions trend', v.impressionsTrend.max, 'Not enough performance data yet.'));
	else checks.push(scored(p, 'impressions_trend', 'Impressions trend', minBand(trend, v.impressionsTrend.bands), v.impressionsTrend.max, trend, `${pct(trend)} vs the previous 28 days.`, 'Grow visibility with regular posts, photos and reviews.'));
	return checks;
};

const engagementChecks = (input: GbpScoreInput): ScoreCheck[] => {
	const e = GBP_SCORE.engagement;
	const p: PillarId = 'engagement';
	const rate = input.performance?.actions_per_1000 ?? null;
	const change = input.performance?.actions_per_1000_change ?? null;
	return [
		rate === null
			? notAvailable(p, 'actions_per_1000', 'Actions per 1,000 impressions', e.actionsPer1000.max, 'Not enough performance data yet.')
			: scored(p, 'actions_per_1000', 'Actions per 1,000 impressions', minBand(rate, e.actionsPer1000.bands), e.actionsPer1000.max, rate, `${rate} calls, clicks and direction requests per 1,000 impressions.`, 'Make calls and bookings easy: accurate phone, website, hours and a clear description.'),
		change === null
			? notAvailable(p, 'actions_trend', 'Engagement trend', e.actionsTrend.max, 'Not enough performance data yet.')
			: scored(p, 'actions_trend', 'Engagement trend', minBand(change, e.actionsTrend.bands), e.actionsTrend.max, change, `${pct(change)} vs the previous 28 days.`, 'Refresh photos and posts to turn more views into actions.'),
	];
};

export const computeGbpScore = (input: GbpScoreInput): GbpScoreResult => {
	const checks = [...completenessChecks(input), ...activityChecks(input), ...reviewChecks(input), ...visibilityChecks(input), ...engagementChecks(input)];
	const pillars: PillarResult[] = PILLARS.map((id) => {
		const available = checks.filter((c) => c.pillar === id && c.status === 'scored');
		const availableMax = available.reduce((s, c) => s + c.max, 0);
		const earned = available.reduce((s, c) => s + c.points, 0);
		const weight = PILLAR_WEIGHTS[id];
		return { id, weight, available: availableMax > 0, earned, available_max: availableMax, score: availableMax > 0 ? round1((earned / availableMax) * weight) : null };
	});
	const included = pillars.filter((p) => p.available);
	const includedWeight = included.reduce((s, p) => s + p.weight, 0);
	const raw = included.reduce((s, p) => s + (p.score ?? 0), 0);
	const score = includedWeight > 0 ? Math.round((raw / includedWeight) * 100) : 0;
	const excluded = pillars.filter((p) => !p.available).map((p) => p.id);
	const lostWeight = (c: ScoreCheck): number => {
		const pillar = pillars.find((p) => p.id === c.pillar) as PillarResult;
		return pillar.available_max > 0 ? ((c.max - c.points) / pillar.available_max) * pillar.weight : 0;
	};
	const topFixes = checks
		.filter((c) => c.status === 'scored' && c.points < c.max)
		.sort((a, b) => lostWeight(b) - lostWeight(a) || a.id.localeCompare(b.id))
		.slice(0, TOP_FIXES);
	return {
		available: true,
		score,
		grade: gradeFor(score),
		partial: excluded.length > 0,
		excluded_pillars: excluded,
		pillars,
		checks,
		top_fixes: topFixes,
	};
};
