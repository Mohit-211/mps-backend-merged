// Who gets AI help (Phase 18, Mohit 2026-10-02). Pure.
// - AI reply drafts: only 4-5 star reviews without a reply on Google that aren't flagged suspicious.
//   1-3 star replies are written by the user.
// - Appeal drafts: a flagged review, or a 1-3 star review (removal requests only make sense there).

export type DraftSkipReason = 'rating_not_eligible' | 'already_replied' | 'flagged' | 'no_rating';

export interface EligibilityInput {
	rating: number | null;
	reply_state: string;
	flag_level: string;
}

export const replyDraftEligibility = (r: EligibilityInput): { eligible: boolean; reason: DraftSkipReason | null } => {
	if (r.rating === null) return { eligible: false, reason: 'no_rating' };
	if (r.rating < 4) return { eligible: false, reason: 'rating_not_eligible' };
	if (r.reply_state === 'sent') return { eligible: false, reason: 'already_replied' };
	if (r.flag_level === 'suspicious') return { eligible: false, reason: 'flagged' };
	return { eligible: true, reason: null };
};

export const appealEligible = (r: Pick<EligibilityInput, 'rating' | 'flag_level'>): boolean =>
	r.flag_level !== 'none' || (r.rating !== null && r.rating <= 3);

/** Tokens for `count` items charged per started batch of 10. */
export const per10 = (count: number, costPer10: number): number => (count <= 0 ? 0 : Math.ceil(count / 10) * costPer10);

/** Splits into batches of at most `size`. */
export const batches = <T>(items: T[], size: number): T[][] => {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
};
