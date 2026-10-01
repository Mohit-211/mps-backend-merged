import httpStatus from 'http-status';
import { Types } from 'mongoose';
import config from '../../configs/config';
import logger from '../../configs/logger';
import { GbpClient, gbpClient } from '../../clients/gbpClient';
import { AiTokenCosts } from '../../billing/constants';
import { GbpReview, IGbpReview, ILocation, Location, ReviewInsight, ReviewReportStatus, UserGBP } from '../../models';
import { FLAG_CODES, ReviewFlag, levelOf } from '../../reviews/flags';
import { appealEligible, batches, per10, replyDraftEligibility } from '../../reviews/eligibility';
import { apiErrorWithData } from '../../utils';
import { AiTaskResult, aiService } from '../ai/ai.service';
import { loadEntitlement } from '../billing/entitlement.service';
import { connectionForBinding } from '../gbp/connections';
import { toGbpApiError } from '../gbp/errors';
import { mapReview } from '../../gbp/mappers';
import { withDefaults } from '../ranking/trackingSettings';
import {
	ANALYSIS_INSTRUCTIONS,
	APPEAL_INSTRUCTIONS,
	GOOGLE_REVIEW_REPORT_URL,
	INSIGHTS_INSTRUCTIONS,
	PolicyReason,
	REPLY_INSTRUCTIONS,
	analysisFormat,
	appealFormat,
	insightsFormat,
	replyFormat,
} from './prompts';
import { reviewStats, updateReviewSummary } from './stats';
import { reviewInputHash, storeReviews } from './store';

// Review management (Phase 18, 2026-10-02). Deterministic first: refresh, lists, stats, flags and sending
// never use AI. AI runs only on an explicit request (drafts for selected 4-5 star reviews, analysis of
// selected reviews, an appeal draft, insights), goes through aiService (tokens, budget, ledger) and is cached
// on the review: the same input is never sent twice unless the user asks to regenerate.

type Id = Types.ObjectId | string;
type LeanReview = IGbpReview & { _id: Types.ObjectId };

const AI_BATCH = 10;
const REPLY_MAX_CHARS = 4000;
const MAX_REVIEW_CHARS_FOR_AI = 800;
const INSIGHT_REVIEWS = 60;
const INSIGHT_CHARS = 300;

export interface ReviewsDeps {
	gbp?: Pick<GbpClient, 'listReviewsSince' | 'updateReply' | 'deleteReply'>;
	ai?: { runAiTask: typeof aiService.runAiTask; status: typeof aiService.status };
	v4Enabled?: boolean;
	now?: () => Date;
}

export interface ListQuery {
	rating?: number[];
	replied?: boolean;
	reply_state?: string;
	flagged?: 'any' | 'suspicious' | 'attention' | 'none';
	has_draft?: boolean;
	search?: string;
	sort?: 'newest' | 'oldest' | 'rating_asc' | 'rating_desc';
	page?: number;
	limit?: number;
}

const firstName = (r: Pick<IGbpReview, 'reviewer'>): string | null => {
	if (r.reviewer?.is_anonymous) return null;
	const first = r.reviewer?.display_name?.trim().split(/\s+/)[0];
	return first && first.length <= 30 ? first : null;
};

const clip = (text: string | null, max: number): string => (text ?? '').slice(0, max);

/** The review as the app shows it. Reviewer names are shown as Google does (display name only). */
export const reviewView = (r: LeanReview) => {
	const hash = reviewInputHash(r);
	const eligibility = replyDraftEligibility(r);
	return {
		review_id: String(r._id),
		rating: r.rating,
		comment: r.comment,
		reviewer: { display_name: r.reviewer?.display_name ?? null, is_anonymous: Boolean(r.reviewer?.is_anonymous) },
		create_time: r.create_time,
		update_time: r.update_time,
		reply: r.reply,
		reply_state: r.reply_state ?? (r.reply ? 'sent' : 'none'),
		sent_at: r.sent_at ?? null,
		send_error: r.send_error ?? null,
		draft: r.draft ? { text: r.draft.text, source: r.draft.source, edited: r.draft.edited, generated_at: r.draft.generated_at, stale: r.draft.input_hash !== hash } : null,
		flags: (r.flags ?? []).map((f) => ({ code: f.code, source: f.source, label: FLAG_CODES[f.code]?.label ?? f.code, detail: f.detail })),
		flag_level: r.flag_level ?? 'none',
		analysis: r.analysis
			? {
					sentiment: r.analysis.sentiment,
					severity: r.analysis.severity,
					suspicious_indicators: r.analysis.suspicious_indicators,
					summary: r.analysis.summary,
					recommended_action: r.analysis.recommended_action,
					analyzed_at: r.analysis.analyzed_at,
					stale: r.analysis.input_hash !== hash,
				}
			: null,
		appeal: r.appeal ? { text: r.appeal.text, policy_reason: r.appeal.policy_reason, generated_at: r.appeal.generated_at, stale: r.appeal.input_hash !== hash } : null,
		report_status: r.report_status ?? 'not_reported',
		ai_reply_eligible: eligibility.eligible,
		ai_reply_skip_reason: eligibility.reason,
		appeal_eligible: appealEligible({ rating: r.rating, flag_level: r.flag_level ?? 'none' }),
		first_seen_at: r.first_seen_at ?? null,
	};
};

export const createReviewsService = (deps: ReviewsDeps = {}) => {
	const gbp = deps.gbp ?? gbpClient;
	const ai = deps.ai ?? aiService;
	const now = deps.now ?? (() => new Date());
	const v4 = () => deps.v4Enabled ?? config.gbp.v4Enabled;

	const notFound = () => apiErrorWithData(httpStatus.NOT_FOUND, 'Review not found', { reason: 'review_not_found' });

	const costsFor = async (location: ILocation): Promise<{ costs: AiTokenCosts; balance: number }> => {
		const { entitlement } = await loadEntitlement(String(location.organization_id), now());
		return { costs: entitlement.tokens.ai_costs, balance: entitlement.tokens.balance };
	};

	/** The location's Google binding, or 400 gbp_not_connected / v4_access_pending. */
	const bindingFor = async (location: ILocation) => {
		if (!v4()) throw apiErrorWithData(httpStatus.BAD_REQUEST, 'Google review access (v4) is not enabled on this server.', { reason: 'v4_access_pending' });
		const binding = await UserGBP.findOne({ location_id: location._id, is_active: true }).lean();
		if (!binding) throw apiErrorWithData(httpStatus.BAD_REQUEST, 'This location is not connected to a Google Business Profile.', { reason: 'gbp_not_connected' });
		return { conn: connectionForBinding(binding), accountName: binding.gbpAccountId, locationName: binding.gbpLocationId };
	};

	const loadSelected = async (location: ILocation, ids: string[]): Promise<{ found: LeanReview[]; missing: string[] }> => {
		const valid = ids.filter((id) => Types.ObjectId.isValid(id));
		const found = await GbpReview.find({ _id: { $in: valid }, location_id: location._id }).lean<LeanReview[]>();
		const have = new Set(found.map((r) => String(r._id)));
		return { found, missing: ids.filter((id) => !have.has(id)) };
	};

	const loadOne = async (location: ILocation, reviewId: string): Promise<LeanReview> => {
		if (!Types.ObjectId.isValid(reviewId)) throw notFound();
		const r = await GbpReview.findOne({ _id: reviewId, location_id: location._id }).lean<LeanReview>();
		if (!r) throw notFound();
		return r;
	};

	const business = (location: ILocation) => ({
		name: location.name,
		category: location.business_category ?? null,
		city: location.city ?? null,
	});

	// ---- lists and stats (no AI) ----

	const list = async (location: ILocation, q: ListQuery) => {
		const filter: Record<string, unknown> = { location_id: location._id };
		if (q.rating?.length) filter.rating = { $in: q.rating };
		if (q.replied === true) filter.reply_state = 'sent';
		if (q.replied === false) filter.reply_state = { $ne: 'sent' };
		if (q.reply_state) filter.reply_state = q.reply_state;
		if (q.flagged === 'any') filter.flag_level = { $ne: 'none' };
		else if (q.flagged) filter.flag_level = q.flagged;
		if (q.has_draft === true) filter.draft = { $ne: null };
		if (q.has_draft === false) filter.draft = null;
		if (q.search) filter.comment = { $regex: q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
		const sort: Record<string, 1 | -1> =
			q.sort === 'oldest' ? { create_time: 1, _id: 1 } : q.sort === 'rating_asc' ? { rating: 1, create_time: -1 } : q.sort === 'rating_desc' ? { rating: -1, create_time: -1 } : { create_time: -1, _id: -1 };
		const page = q.page ?? 1;
		const limit = q.limit ?? 25;
		const [rows, total] = await Promise.all([
			GbpReview.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).lean<LeanReview[]>(),
			GbpReview.countDocuments(filter),
		]);
		return { reviews: rows.map(reviewView), page, limit, total };
	};

	const summary = async (location: ILocation) => {
		const [stats, money, aiStatus] = await Promise.all([reviewStats(location._id as Types.ObjectId, now()), costsFor(location), ai.status()]);
		const refreshedAt = location.reviews_refreshed_at ?? null;
		const minMs = config.reviews.refreshMinMinutes * 60_000;
		return {
			stats,
			last_synced_at: location.gbp_sync?.last_synced_at ?? null,
			last_refreshed_at: refreshedAt,
			next_refresh_allowed_at: refreshedAt ? new Date(refreshedAt.getTime() + minMs) : null,
			v4_enabled: v4(),
			gbp_connected: Boolean(location.gbp_connected),
			ai: { configured: aiStatus.configured, paused_today: aiStatus.budget_reached, token_costs: money.costs, token_balance: money.balance },
		};
	};

	// ---- refresh (Google, no AI) ----

	const refresh = async (location: ILocation) => {
		const { conn, accountName, locationName } = await bindingFor(location);
		const at = now();
		const minMs = config.reviews.refreshMinMinutes * 60_000;
		// Compare-and-set: parallel clicks can't both refresh.
		const claimed = await Location.findOneAndUpdate(
			{ _id: location._id, $or: [{ reviews_refreshed_at: null }, { reviews_refreshed_at: { $exists: false } }, { reviews_refreshed_at: { $lte: new Date(at.getTime() - minMs) } }] },
			{ $set: { reviews_refreshed_at: at } },
		);
		if (!claimed) {
			const last = (await Location.findById(location._id).select({ reviews_refreshed_at: 1 }).lean())?.reviews_refreshed_at ?? at;
			throw apiErrorWithData(httpStatus.TOO_MANY_REQUESTS, `Reviews can be refreshed once every ${config.reviews.refreshMinMinutes} minutes.`, {
				reason: 'rate_limited',
				next_allowed_at: new Date(last.getTime() + minMs),
			});
		}
		const newest = await GbpReview.findOne({ location_id: location._id, update_time: { $ne: null } }).sort({ update_time: -1 }).select({ update_time: 1 }).lean();
		let listed: Awaited<ReturnType<typeof gbp.listReviewsSince>>;
		try {
			listed = await gbp.listReviewsSince(conn, accountName, locationName, newest?.update_time ?? null);
		} catch (err) {
			// The attempt didn't happen: give the click back.
			await Location.updateOne({ _id: location._id }, { $set: { reviews_refreshed_at: location.reviews_refreshed_at ?? null } });
			throw toGbpApiError(err);
		}
		const docs = listed.items.map((r) => mapReview(r, location._id as Types.ObjectId, at)).filter((d): d is NonNullable<typeof d> => d !== null);
		const stored = await storeReviews(location._id as Types.ObjectId, docs, at);
		logger.info(`reviews: refresh location ${String(location._id)} pages=${listed.pages} new=${stored.new_reviews} changed=${stored.changed}`);
		return { refreshed_at: at, google_calls: listed.pages, new_reviews: stored.new_reviews, updated_reviews: stored.stored - stored.new_reviews, stats: await reviewStats(location._id as Types.ObjectId, at) };
	};

	// ---- reply drafts (AI, 4-5 stars only) ----

	const generateDrafts = async (location: ILocation, userId: Id, ids: string[], regenerate = false) => {
		const { found, missing } = await loadSelected(location, ids);
		const skipped: { review_id: string; reason: string }[] = missing.map((id) => ({ review_id: id, reason: 'not_found' }));
		const toGenerate: LeanReview[] = [];
		const kept: LeanReview[] = [];
		for (const r of found) {
			const e = replyDraftEligibility(r);
			if (!e.eligible) {
				skipped.push({ review_id: String(r._id), reason: e.reason ?? 'not_eligible' });
				continue;
			}
			const fresh = r.draft && r.draft.input_hash === reviewInputHash(r);
			// A draft the user wrote or edited is never overwritten without `regenerate`.
			if (!regenerate && r.draft && (fresh || r.draft.source === 'user' || r.draft.edited)) kept.push(r);
			else toGenerate.push(r);
		}
		let tokensSpent = 0;
		if (toGenerate.length) {
			const { costs } = await costsFor(location);
			const keywords = withDefaults(location.tracking).keywords.slice(0, 8).map((k) => k.text);
			for (const batch of batches(toGenerate, AI_BATCH)) {
				const input = JSON.stringify({
					business: business(location),
					keywords,
					reviews: batch.map((r, i) => ({ id: String(i), rating: r.rating, first_name: firstName(r), text: clip(r.comment, MAX_REVIEW_CHARS_FOR_AI) })),
				});
				const result: AiTaskResult<{ replies: { id: string; reply: string }[] }> = await ai.runAiTask({
					task: 'review_reply_drafts',
					organizationId: location.organization_id as Types.ObjectId,
					locationId: location._id as Types.ObjectId,
					userId,
					tokenCost: per10(batch.length, costs.reply_drafts_per_10),
					instructions: REPLY_INSTRUCTIONS,
					input,
					format: replyFormat,
					maxOutputTokens: 200 + batch.length * 150,
					items: batch.length,
				});
				tokensSpent += result.tokens_spent;
				const at = now();
				const ops = [];
				for (const reply of result.data.replies ?? []) {
					const r = batch[Number(reply.id)];
					const text = reply.reply?.trim();
					if (!r || !text) continue;
					ops.push({
						updateOne: {
							filter: { _id: r._id },
							update: {
								$set: {
									draft: { text: text.slice(0, REPLY_MAX_CHARS), source: 'ai', ai_model: result.model, generated_at: at, input_hash: reviewInputHash(r), edited: false },
									...(r.reply_state === 'sent' ? {} : { reply_state: 'draft' }),
								},
							},
						},
					});
				}
				if (ops.length) await GbpReview.bulkWrite(ops, { ordered: false });
			}
		}
		await updateReviewSummary(location._id as Types.ObjectId, now());
		const ids2 = [...toGenerate, ...kept].map((r) => r._id);
		const rows = await GbpReview.find({ _id: { $in: ids2 } }).lean<LeanReview[]>();
		return { drafts: rows.map(reviewView), generated: toGenerate.length, reused: kept.length, skipped, tokens_spent: tokensSpent };
	};

	const saveDraft = async (location: ILocation, reviewId: string, text: string) => {
		const r = await loadOne(location, reviewId);
		const draft = {
			text: text.trim().slice(0, REPLY_MAX_CHARS),
			source: r.draft?.source === 'ai' ? ('ai' as const) : ('user' as const),
			ai_model: r.draft?.ai_model ?? null,
			generated_at: r.draft?.generated_at ?? now(),
			input_hash: reviewInputHash(r),
			edited: r.draft?.source === 'ai' ? true : false,
		};
		await GbpReview.updateOne({ _id: r._id }, { $set: { draft, ...(r.reply_state === 'sent' ? {} : { reply_state: 'draft' }) } });
		await updateReviewSummary(location._id as Types.ObjectId, now());
		return reviewView((await GbpReview.findById(r._id).lean<LeanReview>()) as LeanReview);
	};

	const deleteDraft = async (location: ILocation, reviewId: string) => {
		const r = await loadOne(location, reviewId);
		await GbpReview.updateOne({ _id: r._id }, { $set: { draft: null, ...(r.reply_state === 'sent' ? {} : { reply_state: 'none', send_error: null }) } });
		await updateReviewSummary(location._id as Types.ObjectId, now());
		return { deleted: true, review_id: reviewId };
	};

	// ---- sending (Google, explicit) ----

	const send = async (location: ILocation, userId: Id, ids: string[]) => {
		const { conn } = await bindingFor(location);
		const { found, missing } = await loadSelected(location, ids);
		const results: { review_id: string; status: 'sent' | 'failed' | 'skipped'; reason: string | null }[] = missing.map((id) => ({ review_id: id, status: 'skipped' as const, reason: 'not_found' }));
		for (const r of found) {
			const text = r.draft?.text?.trim();
			if (!text) {
				results.push({ review_id: String(r._id), status: 'skipped', reason: 'no_draft' });
				continue;
			}
			try {
				const reply = await gbp.updateReply(conn, r.review_name, text);
				const at = now();
				await GbpReview.updateOne(
					{ _id: r._id },
					{
						$set: {
							reply: { comment: reply.comment ?? text, update_time: reply.updateTime ? new Date(reply.updateTime) : at },
							reply_state: 'sent',
							sent_at: at,
							sent_by: new Types.ObjectId(String(userId)),
							send_error: null,
							draft: null,
						},
					},
				);
				results.push({ review_id: String(r._id), status: 'sent', reason: null });
			} catch (err) {
				const mapped = toGbpApiError(err);
				const message = mapped instanceof Error ? mapped.message : 'Google did not accept the reply.';
				await GbpReview.updateOne({ _id: r._id }, { $set: { reply_state: 'failed', send_error: message } });
				results.push({ review_id: String(r._id), status: 'failed', reason: message });
				logger.warn(`reviews: reply to a review of location ${String(location._id)} failed: ${message}`);
			}
		}
		await updateReviewSummary(location._id as Types.ObjectId, now());
		return { results, sent: results.filter((x) => x.status === 'sent').length, failed: results.filter((x) => x.status === 'failed').length };
	};

	const deleteReply = async (location: ILocation, reviewId: string) => {
		const { conn } = await bindingFor(location);
		const r = await loadOne(location, reviewId);
		if (!r.reply) throw apiErrorWithData(httpStatus.BAD_REQUEST, 'This review has no reply.', { reason: 'no_reply' });
		try {
			await gbp.deleteReply(conn, r.review_name);
		} catch (err) {
			throw toGbpApiError(err);
		}
		await GbpReview.updateOne({ _id: r._id }, { $set: { reply: null, reply_state: r.draft ? 'draft' : 'none', sent_at: null } });
		await updateReviewSummary(location._id as Types.ObjectId, now());
		return { deleted: true, review_id: reviewId };
	};

	// ---- analysis (AI, explicit) ----

	const analyze = async (location: ILocation, userId: Id, ids: string[], regenerate = false) => {
		const { found, missing } = await loadSelected(location, ids);
		const skipped: { review_id: string; reason: string }[] = missing.map((id) => ({ review_id: id, reason: 'not_found' }));
		const todo: LeanReview[] = [];
		const reused: LeanReview[] = [];
		for (const r of found) {
			if (!r.comment?.trim()) skipped.push({ review_id: String(r._id), reason: 'no_text' });
			else if (!regenerate && r.analysis && r.analysis.input_hash === reviewInputHash(r)) reused.push(r);
			else todo.push(r);
		}
		let tokensSpent = 0;
		if (todo.length) {
			const { costs } = await costsFor(location);
			for (const batch of batches(todo, AI_BATCH)) {
				const result: AiTaskResult<{ results: { id: string; sentiment: string; severity: string; suspicious_indicators: string[]; summary: string; recommended_action: string }[] }> =
					await ai.runAiTask({
						task: 'review_analysis',
						organizationId: location.organization_id as Types.ObjectId,
						locationId: location._id as Types.ObjectId,
						userId,
						tokenCost: per10(batch.length, costs.analysis_per_10),
						instructions: ANALYSIS_INSTRUCTIONS,
						input: JSON.stringify({ business: business(location), reviews: batch.map((r, i) => ({ id: String(i), rating: r.rating, text: clip(r.comment, MAX_REVIEW_CHARS_FOR_AI) })) }),
						format: analysisFormat,
						maxOutputTokens: 200 + batch.length * 160,
						items: batch.length,
					});
				tokensSpent += result.tokens_spent;
				const at = now();
				for (const a of result.data.results ?? []) {
					const r = batch[Number(a.id)];
					if (!r) continue;
					const indicators = (a.suspicious_indicators ?? []).map((x) => x.slice(0, 120)).slice(0, 5);
					const aiFlags: ReviewFlag[] = [];
					if (indicators.length) aiFlags.push({ code: 'ai_suspicious', source: 'ai', detail: indicators.join('; ') });
					if (a.severity === 'high') aiFlags.push({ code: 'ai_serious', source: 'ai', detail: a.summary?.slice(0, 200) ?? null });
					const flags = [...(r.flags ?? []).filter((f) => f.source !== 'ai'), ...aiFlags];
					await GbpReview.updateOne(
						{ _id: r._id },
						{
							$set: {
								analysis: {
									sentiment: a.sentiment,
									severity: a.severity,
									suspicious_indicators: indicators,
									summary: (a.summary ?? '').slice(0, 300),
									recommended_action: (a.recommended_action ?? '').slice(0, 300),
									ai_model: result.model,
									analyzed_at: at,
									input_hash: reviewInputHash(r),
								},
								flags,
								flag_level: levelOf(flags),
							},
						},
					);
				}
			}
		}
		await updateReviewSummary(location._id as Types.ObjectId, now());
		const rows = await GbpReview.find({ _id: { $in: [...todo, ...reused].map((r) => r._id) } }).lean<LeanReview[]>();
		return { reviews: rows.map(reviewView), analyzed: todo.length, reused: reused.length, skipped, tokens_spent: tokensSpent };
	};

	// ---- appeal / report drafts (AI, explicit; submitted on Google by the user) ----

	const appealDraft = async (location: ILocation, userId: Id, reviewId: string, regenerate = false) => {
		const r = await loadOne(location, reviewId);
		if (!appealEligible({ rating: r.rating, flag_level: r.flag_level ?? 'none' })) {
			throw apiErrorWithData(httpStatus.BAD_REQUEST, 'Removal requests are for flagged or 1-3 star reviews.', { reason: 'not_eligible' });
		}
		let tokensSpent = 0;
		if (regenerate || !r.appeal || r.appeal.input_hash !== reviewInputHash(r)) {
			const { costs } = await costsFor(location);
			const result: AiTaskResult<{ policy_reason: PolicyReason; report_text: string }> = await ai.runAiTask({
				task: 'review_appeal',
				organizationId: location.organization_id as Types.ObjectId,
				locationId: location._id as Types.ObjectId,
				userId,
				tokenCost: costs.appeal,
				instructions: APPEAL_INSTRUCTIONS,
				input: JSON.stringify({
					business: business(location),
					review: { rating: r.rating, date: r.create_time, text: clip(r.comment, MAX_REVIEW_CHARS_FOR_AI) },
					indicators: [...(r.flags ?? []).map((f) => FLAG_CODES[f.code]?.label ?? f.code), ...(r.analysis?.suspicious_indicators ?? [])],
				}),
				format: appealFormat,
				maxOutputTokens: 500,
				items: 1,
			});
			tokensSpent = result.tokens_spent;
			await GbpReview.updateOne(
				{ _id: r._id },
				{ $set: { appeal: { text: result.data.report_text.slice(0, 2000), policy_reason: result.data.policy_reason, ai_model: result.model, generated_at: now(), input_hash: reviewInputHash(r) } } },
			);
		}
		const review = reviewView((await GbpReview.findById(r._id).lean<LeanReview>()) as LeanReview);
		return { review, appeal: review.appeal, report_url: GOOGLE_REVIEW_REPORT_URL, tokens_spent: tokensSpent };
	};

	const setReportStatus = async (location: ILocation, reviewId: string, status: ReviewReportStatus) => {
		const r = await loadOne(location, reviewId);
		await GbpReview.updateOne({ _id: r._id }, { $set: { report_status: status, report_status_at: now() } });
		return reviewView((await GbpReview.findById(r._id).lean<LeanReview>()) as LeanReview);
	};

	// ---- insights (AI, explicit, stored) ----

	const getInsights = async (location: ILocation) => {
		const doc = await ReviewInsight.findOne({ location_id: location._id }).lean();
		if (!doc) throw apiErrorWithData(httpStatus.NOT_FOUND, 'No review insights yet.', { reason: 'no_insights' });
		return { generated_at: doc.generated_at, ai_model: doc.ai_model, basis: doc.basis, insight: doc.insight };
	};

	const generateInsights = async (location: ILocation, userId: Id) => {
		const id = location._id as Types.ObjectId;
		const [counts, recent] = await Promise.all([
			GbpReview.aggregate<{ _id: { month: string; rating: number | null }; n: number }>([
				{ $match: { location_id: id, create_time: { $ne: null } } },
				{ $group: { _id: { month: { $dateToString: { format: '%Y-%m', date: '$create_time' } }, rating: '$rating' }, n: { $sum: 1 } } },
			]),
			GbpReview.find({ location_id: id, comment: { $nin: [null, ''] } })
				.sort({ create_time: -1 })
				.limit(INSIGHT_REVIEWS)
				.select({ rating: 1, comment: 1, create_time: 1 })
				.lean<LeanReview[]>(),
		]);
		if (!recent.length) throw apiErrorWithData(httpStatus.BAD_REQUEST, 'There are no reviews with text to analyse yet.', { reason: 'no_reviews' });
		const byMonth = new Map<string, Record<string, number>>();
		for (const c of counts) {
			const m = byMonth.get(c._id.month) ?? {};
			m[String(c._id.rating ?? 'none')] = c.n;
			byMonth.set(c._id.month, m);
		}
		const months = [...byMonth.keys()].sort().slice(-12);
		const { costs } = await costsFor(location);
		const result: AiTaskResult<{ themes: { theme: string; mentions: number; sentiment: 'positive' | 'negative' | 'mixed' }[]; praise: string[]; complaints: string[]; observations: string[] }> =
			await ai.runAiTask({
				task: 'review_insights',
				organizationId: location.organization_id as Types.ObjectId,
				locationId: id,
				userId,
				tokenCost: costs.insights,
				instructions: INSIGHTS_INSTRUCTIONS,
				input: JSON.stringify({
					business: business(location),
					ratings_by_month: months.map((m) => ({ month: m, ...byMonth.get(m) })),
					excerpts: recent.map((r) => ({ rating: r.rating, month: r.create_time?.toISOString().slice(0, 7) ?? null, text: clip(r.comment, INSIGHT_CHARS) })),
				}),
				format: insightsFormat,
				maxOutputTokens: 900,
				items: recent.length,
			});
		const total = counts.reduce((s, c) => s + c.n, 0);
		const at = now();
		const doc = {
			location_id: id,
			generated_at: at,
			generated_by: new Types.ObjectId(String(userId)),
			ai_model: result.model,
			basis: { reviews_total: total, reviews_sent: recent.length, from: recent[recent.length - 1]?.create_time ?? null, to: recent[0]?.create_time ?? null },
			insight: {
				themes: (result.data.themes ?? []).slice(0, 6),
				praise: (result.data.praise ?? []).slice(0, 4),
				complaints: (result.data.complaints ?? []).slice(0, 4),
				observations: (result.data.observations ?? []).slice(0, 3),
			},
		};
		await ReviewInsight.updateOne({ location_id: id }, { $set: doc }, { upsert: true });
		return { generated_at: at, ai_model: result.model, basis: doc.basis, insight: doc.insight, tokens_spent: result.tokens_spent };
	};

	return { list, summary, refresh, generateDrafts, saveDraft, deleteDraft, send, deleteReply, analyze, appealDraft, setReportStatus, getInsights, generateInsights };
};

export const reviewsService = createReviewsService();
