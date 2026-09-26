import { PUBLIC_SCORE, maxBand, minBand } from '../scoring.config';

// Public Score (Phase 7c): the same formula for the client and each competitor, from public data
// only (Place Details + center ranks from the latest rank run's map list). Pure.

export interface PublicInputs {
	rating: number | null;
	user_rating_count: number | null;
	primary_type: string | null;
	has_hours: boolean;
	has_website: boolean;
	has_phone: boolean;
	/** null = not fetched (the Atmosphere-tier field is off): that part is not available. */
	has_editorial_summary: boolean | null;
	business_status: string | null;
	/** Center ranks per keyword from the map list (null = not in the top 20). */
	center_ranks: (number | null)[];
}

export interface PublicScorePart {
	id: 'rating' | 'review_count' | 'center_rank' | 'center_top3' | (typeof PUBLIC_SCORE.profileFields)[number];
	points: number;
	max: number;
	available: boolean;
}

export interface PublicScore {
	score: number;
	parts: PublicScorePart[];
	/** Set when the business isn't operational (score 0). */
	flag: 'closed_temporarily' | 'closed_permanently' | null;
}

export interface CenterRank {
	avg: number | null;
	top3_rate: number | null;
	keywords_found: number;
	keywords: number;
}

const round1 = (v: number): number => Math.round((v + Number.EPSILON) * 10) / 10;

export const centerRank = (ranks: (number | null)[]): CenterRank => {
	if (ranks.length === 0) return { avg: null, top3_rate: null, keywords_found: 0, keywords: 0 };
	const missing = PUBLIC_SCORE.centerRank.missingRank;
	const values = ranks.map((r) => r ?? missing);
	return {
		avg: round1(values.reduce((s, v) => s + v, 0) / values.length),
		top3_rate: Math.round((ranks.filter((r) => r !== null && r <= 3).length / ranks.length) * 100) / 100,
		keywords_found: ranks.filter((r) => r !== null).length,
		keywords: ranks.length,
	};
};

const flagFor = (status: string | null): PublicScore['flag'] =>
	status === 'CLOSED_TEMPORARILY' ? 'closed_temporarily' : status === 'CLOSED_PERMANENTLY' ? 'closed_permanently' : null;

export const computePublicScore = (input: PublicInputs): PublicScore => {
	const c = PUBLIC_SCORE;
	const rank = centerRank(input.center_ranks);
	const profile: Record<(typeof c.profileFields)[number], boolean | null> = {
		primary_category: Boolean(input.primary_type),
		hours: input.has_hours,
		website: input.has_website,
		phone: input.has_phone,
		editorial_summary: input.has_editorial_summary,
	};
	const parts: PublicScorePart[] = [
		{ id: 'rating', points: input.rating === null ? 0 : minBand(input.rating, c.rating.bands), max: c.rating.max, available: true },
		{ id: 'review_count', points: minBand(input.user_rating_count ?? 0, c.reviewCount.bands), max: c.reviewCount.max, available: true },
		{ id: 'center_rank', points: rank.avg === null ? 0 : maxBand(rank.avg, c.centerRank.bands), max: c.centerRank.max, available: rank.avg !== null },
		{ id: 'center_top3', points: rank.top3_rate === null ? 0 : Math.round(rank.top3_rate * c.centerTop3.max), max: c.centerTop3.max, available: rank.top3_rate !== null },
		...c.profileFields.map((id) => ({ id, points: profile[id] ? c.profileField : 0, max: c.profileField, available: profile[id] !== null })),
	];
	const flag = flagFor(input.business_status);
	const available = parts.filter((p) => p.available);
	const max = available.reduce((s, p) => s + p.max, 0);
	const earned = available.reduce((s, p) => s + p.points, 0);
	return { score: flag || max === 0 ? 0 : Math.round((earned / max) * 100), parts, flag };
};
