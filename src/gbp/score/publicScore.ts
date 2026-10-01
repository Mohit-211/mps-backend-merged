import { PUBLIC_SCORE, minBand } from '../scoring.config';

// Public Score (Phase 7c; version 2 since 2026-10-02): the same formula for the client and each
// competitor, from public Place Details only: rating, review count and profile fields, rescaled to 100.
// Ranking data stays in the ranking pages and report (Mohit, 2026-10-02). Pure.

export interface PublicInputs {
	rating: number | null;
	user_rating_count: number | null;
	primary_type: string | null;
	has_hours: boolean;
	has_website: boolean;
	has_phone: boolean;
	/** null = not fetched: that part is not available. */
	has_editorial_summary: boolean | null;
	business_status: string | null;
}

export interface PublicScorePart {
	id: 'rating' | 'review_count' | (typeof PUBLIC_SCORE.profileFields)[number];
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

const flagFor = (status: string | null): PublicScore['flag'] =>
	status === 'CLOSED_TEMPORARILY' ? 'closed_temporarily' : status === 'CLOSED_PERMANENTLY' ? 'closed_permanently' : null;

export const computePublicScore = (input: PublicInputs): PublicScore => {
	const c = PUBLIC_SCORE;
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
		...c.profileFields.map((id) => ({ id, points: profile[id] ? c.profileField : 0, max: c.profileField, available: profile[id] !== null })),
	];
	const flag = flagFor(input.business_status);
	const available = parts.filter((p) => p.available);
	const max = available.reduce((s, p) => s + p.max, 0);
	const earned = available.reduce((s, p) => s + p.points, 0);
	return { score: flag || max === 0 ? 0 : Math.round((earned / max) * 100), parts, flag };
};
