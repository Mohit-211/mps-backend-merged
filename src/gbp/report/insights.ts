import { MAX_INSIGHTS } from '../scoring.config';
import { CompetitorRow } from './competitors';

// Gap insights (Phase 7c), pure: rule-based sentences comparing the client with its competitors.
// Each rule yields an impact in 0–1; the top MAX_INSIGHTS are returned, highest impact first.

export interface Insight {
	id: 'review_gap' | 'rating_gap' | 'missing_hours' | 'missing_website' | 'missing_phone' | 'rank_gap' | 'category_mismatch';
	impact: number;
	message: string;
	/** The competitor the insight refers to, if one. */
	place_id: string | null;
}

const clamp = (v: number): number => Math.max(0, Math.min(1, Math.round(v * 100) / 100));
const label = (row: CompetitorRow): string => row.name ?? 'A competitor';

export const gapInsights = (rows: CompetitorRow[]): Insight[] => {
	const self = rows.find((r) => r.is_self && r.fetched_at);
	const others = rows.filter((r) => !r.is_self && r.fetched_at && r.business_status !== 'CLOSED_PERMANENTLY');
	if (!self || others.length === 0) return [];
	const insights: Insight[] = [];

	// Review count: the best competitor has at least twice as many reviews.
	const mine = self.user_rating_count ?? 0;
	const mostReviews = [...others].sort((a, b) => (b.user_rating_count ?? 0) - (a.user_rating_count ?? 0))[0];
	const theirs = mostReviews.user_rating_count ?? 0;
	if (theirs >= 2 * Math.max(mine, 1) && theirs > mine) {
		const ratio = mine > 0 ? theirs / mine : theirs;
		insights.push({
			id: 'review_gap',
			impact: clamp(0.5 + Math.log10(ratio) / 2),
			message: `${label(mostReviews)} has ${theirs} reviews; you have ${mine}${mine > 0 ? ` (${Math.round(ratio * 10) / 10}× more)` : ''}. Ask every happy customer for a review.`,
			place_id: mostReviews.place_id,
		});
	}

	// Rating: at least 0.2 stars below the best-rated competitor.
	const bestRated = [...others].filter((r) => r.rating !== null).sort((a, b) => (b.rating as number) - (a.rating as number))[0];
	if (bestRated && self.rating !== null && (bestRated.rating as number) - self.rating >= 0.2) {
		const gap = Math.round(((bestRated.rating as number) - self.rating) * 10) / 10;
		insights.push({
			id: 'rating_gap',
			impact: clamp(0.4 + gap / 2),
			message: `${label(bestRated)} is rated ${bestRated.rating}; you are rated ${self.rating}. Reply to reviews and resolve complaints to lift your rating.`,
			place_id: bestRated.place_id,
		});
	}

	// Missing basics that most competitors show.
	const share = (pick: (r: CompetitorRow) => boolean) => others.filter(pick).length / others.length;
	const basics: { id: Insight['id']; missing: boolean; has: (r: CompetitorRow) => boolean; what: string; weight: number }[] = [
		{ id: 'missing_hours', missing: !self.has_hours, has: (r) => r.has_hours, what: 'opening hours', weight: 0.7 },
		{ id: 'missing_website', missing: !self.has_website, has: (r) => r.has_website, what: 'a website', weight: 0.6 },
		{ id: 'missing_phone', missing: !self.has_phone, has: (r) => r.has_phone, what: 'a phone number', weight: 0.6 },
	];
	for (const b of basics) {
		const s = share(b.has);
		if (b.missing && s >= 0.5) {
			insights.push({ id: b.id, impact: clamp(b.weight * s + 0.2), message: `${Math.round(s * 100)} % of your competitors show ${b.what} on Google; you don't. Add it to your profile.`, place_id: null });
		}
	}

	// Rank: a competitor out-ranks you at the center on at least half the keywords.
	const myRank = self.center_rank;
	if (myRank.keywords > 0 && myRank.avg !== null) {
		const myAvg = myRank.avg;
		const better = others
			.filter((r) => r.center_rank.avg !== null && (r.center_rank.avg as number) < myAvg && r.center_rank.keywords_found >= myRank.keywords / 2)
			.sort((a, b) => (a.center_rank.avg as number) - (b.center_rank.avg as number))[0];
		if (better) {
			insights.push({
				id: 'rank_gap',
				impact: clamp(0.5 + (myAvg - (better.center_rank.avg as number)) / 40),
				message: `${label(better)} ranks higher than you at your location (average ${better.center_rank.avg} vs ${myAvg}). Compare their categories, reviews and posts with yours.`,
				place_id: better.place_id,
			});
		}
	}

	// Category: most competitors use another primary category.
	if (self.primary_type) {
		const counts = new Map<string, { n: number; label: string | null }>();
		for (const r of others) {
			if (!r.primary_type) continue;
			const c = counts.get(r.primary_type) ?? { n: 0, label: r.primary_type_label };
			counts.set(r.primary_type, { n: c.n + 1, label: c.label });
		}
		const [topType, top] = [...counts.entries()].sort((a, b) => b[1].n - a[1].n)[0] ?? [];
		if (topType && top && topType !== self.primary_type && top.n / others.length > 0.5) {
			insights.push({
				id: 'category_mismatch',
				impact: clamp(0.3 + (top.n / others.length) * 0.3),
				message: `Most competitors use "${top.label ?? topType}" as their primary category; yours is "${self.primary_type_label ?? self.primary_type}". Check your primary category matches your main service.`,
				place_id: null,
			});
		}
	}

	return insights.sort((a, b) => b.impact - a.impact || a.id.localeCompare(b.id)).slice(0, MAX_INSIGHTS);
};
