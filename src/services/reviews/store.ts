import crypto from 'crypto';
import { Types } from 'mongoose';
import { GbpReview, IGbpReview } from '../../models';
import { ReviewFlag, fingerprintOf, flagContext, levelOf, systemFlags } from '../../reviews/flags';
import { updateReviewSummary } from './stats';

// Storing reviews from Google (Phase 18): used by the monthly gbp-sync and the Refresh Reviews button.
// New or changed reviews get their fingerprint and system flags; AI flags are kept unless the text changed.
// A reply found on Google marks the review sent; a reply removed on Google clears it. No AI here.

type Id = Types.ObjectId | string;

export interface MappedReview {
	location_id: Types.ObjectId;
	review_name: string;
	rating: number | null;
	comment: string | null;
	create_time: Date | null;
	update_time: Date | null;
	reply: { comment: string; update_time: Date | null } | null;
	reviewer: { display_name: string | null; is_anonymous: boolean };
	synced_at: Date;
}

/** What an AI result was made from: a change here makes drafts, analyses and appeals stale. */
export const reviewInputHash = (r: { rating: number | null; comment: string | null }): string =>
	crypto.createHash('sha1').update(`${r.rating ?? ''}|${r.comment ?? ''}`).digest('hex').slice(0, 16);

export interface StoreResult {
	stored: number;
	new_reviews: number;
	changed: number;
	/** Ids (review_name) stored or changed in this call. */
	names: string[];
}

export const storeReviews = async (locationId: Id, docs: MappedReview[], at: Date): Promise<StoreResult> => {
	if (docs.length === 0) return { stored: 0, new_reviews: 0, changed: 0, names: [] };
	const existing = await GbpReview.find({ review_name: { $in: docs.map((d) => d.review_name) } })
		.select({ review_name: 1, rating: 1, comment: 1, reply_state: 1, reply: 1, flags: 1 })
		.lean<Pick<IGbpReview, 'review_name' | 'rating' | 'comment' | 'reply_state' | 'reply' | 'flags'>[]>();
	const byName = new Map(existing.map((e) => [e.review_name, e]));
	let newReviews = 0;
	let changed = 0;
	const ops = docs.map((d) => {
		const prev = byName.get(d.review_name);
		const set: Record<string, unknown> = { ...d, fingerprint: fingerprintOf(d.comment) };
		const setOnInsert: Record<string, unknown> = { first_seen_at: at, report_status: 'not_reported', draft: null, analysis: null, appeal: null, flags: [], flag_level: 'none' };
		if (!prev) {
			newReviews += 1;
			setOnInsert.reply_state = d.reply ? 'sent' : 'none';
		} else {
			const textChanged = prev.comment !== d.comment || prev.rating !== d.rating;
			if (textChanged) {
				changed += 1;
				// AI flags were about the old text.
				set.flags = (prev.flags ?? []).filter((f) => f.source !== 'ai');
			}
			// Google is the truth for whether a reply exists.
			if (d.reply && prev.reply_state !== 'sent') set.reply_state = 'sent';
			if (!d.reply && prev.reply_state === 'sent') set.reply_state = 'none';
		}
		return { updateOne: { filter: { review_name: d.review_name }, update: { $set: set, $setOnInsert: setOnInsert }, upsert: true } };
	});
	await GbpReview.bulkWrite(ops, { ordered: false });
	await recomputeFlags(locationId);
	await updateReviewSummary(locationId, at);
	return { stored: docs.length, new_reviews: newReviews, changed, names: docs.map((d) => d.review_name) };
};

/**
 * System flags for every review of the location (duplicates and bursts depend on the others). Keeps AI flags.
 * Writes only the reviews whose flags changed.
 */
export const recomputeFlags = async (locationId: Id): Promise<number> => {
	const reviews = await GbpReview.find({ location_id: locationId })
		.select({ rating: 1, comment: 1, create_time: 1, reviewer: 1, fingerprint: 1, flags: 1, flag_level: 1 })
		.lean<Pick<IGbpReview, '_id' | 'rating' | 'comment' | 'create_time' | 'reviewer' | 'fingerprint' | 'flags' | 'flag_level'>[]>();
	const ctx = flagContext(reviews);
	const ops = [];
	for (const r of reviews) {
		const ai = (r.flags ?? []).filter((f) => f.source === 'ai');
		const flags: ReviewFlag[] = [...systemFlags(r, ctx), ...ai];
		const level = levelOf(flags);
		const same = JSON.stringify(flags) === JSON.stringify(r.flags ?? []) && level === r.flag_level;
		if (!same) ops.push({ updateOne: { filter: { _id: r._id }, update: { $set: { flags, flag_level: level } } } });
	}
	if (ops.length) await GbpReview.bulkWrite(ops, { ordered: false });
	return ops.length;
};
