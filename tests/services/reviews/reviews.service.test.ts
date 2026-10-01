import { Types } from 'mongoose';
import { RawReview } from '../../../src/clients/types/gbp';
import { GbpReview, ILocation, Location, Organization, ReviewInsight, UserGBP } from '../../../src/models';
import { AiTaskRequest } from '../../../src/services/ai/ai.service';
import { createReviewsService } from '../../../src/services/reviews/reviews.service';
import { clearDb, createLocation, createUser, ensureOrg, keywordsOf, startTestDb } from '../../helpers/mongoose';

// Phase 18: review management with a fake Google client and a fake AI layer. Checks the rules that keep
// costs down: no AI on refresh, only eligible reviews to AI, cached results reused, per-batch token charges.

let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
	await Promise.all([GbpReview.syncIndexes(), ReviewInsight.syncIndexes(), UserGBP.syncIndexes()]);
}, 60000);
afterAll(async () => db.stop());
beforeEach(async () => clearDb());

const NOW = new Date('2026-10-02T12:00:00Z');
const ACC = 'accounts/1';
const LOC = 'locations/1';
const raw = (id: number, stars: string, comment: string | undefined, updated: string, reply?: string): RawReview => ({
	name: `${ACC}/${LOC}/reviews/r${id}`,
	reviewer: { displayName: `Reviewer ${id} Smith`, isAnonymous: false },
	starRating: stars,
	comment,
	createTime: updated,
	updateTime: updated,
	...(reply ? { reviewReply: { comment: reply, updateTime: updated } } : {}),
});

const REVIEWS: RawReview[] = [
	raw(1, 'FIVE', 'Fixed our boiler on a Sunday, very tidy work and a fair price, thank you!', '2026-09-30T10:00:00Z'),
	raw(2, 'FOUR', 'Good job on the kitchen sink, arrived a bit late though.', '2026-09-29T10:00:00Z'),
	raw(3, 'TWO', 'They overcharged me for a simple drain clean.', '2026-09-28T10:00:00Z'),
	raw(4, 'FIVE', 'Great work, see my site www.cheap-plumbers.biz', '2026-09-27T10:00:00Z'),
	raw(5, 'FIVE', 'Lovely people', '2026-09-26T10:00:00Z', 'Thanks!'),
];

interface Gbp {
	listCalls: (Date | null)[];
	sent: string[];
	failOn?: string;
}
const fakeGbp = (state: Gbp, items: RawReview[] = REVIEWS) => ({
	listReviewsSince: async (_c: unknown, _a: string, _l: string, since: Date | null) => {
		state.listCalls.push(since);
		const list = items.filter((r) => !since || new Date(r.updateTime as string) > since);
		return { items: list, pages: 1, averageRating: 4.2, totalReviewCount: items.length };
	},
	updateReply: async (_c: unknown, name: string, comment: string) => {
		if (state.failOn && name.endsWith(state.failOn)) throw new Error('google says no');
		state.sent.push(name);
		return { comment, updateTime: NOW.toISOString() };
	},
	deleteReply: async () => undefined,
});

const fakeAi = () => {
	const calls: AiTaskRequest[] = [];
	return {
		calls,
		ai: {
			status: async () => ({ configured: true, budget_reached: false }),
			runAiTask: async <T>(req: AiTaskRequest) => {
				calls.push(req);
				const input = JSON.parse(req.input) as { reviews?: { id: string }[] };
				let data: unknown;
				if (req.task === 'review_reply_drafts') data = { replies: (input.reviews ?? []).map((r) => ({ id: r.id, reply: `Thanks, reply ${r.id}` })) };
				else if (req.task === 'review_analysis')
					data = { results: (input.reviews ?? []).map((r) => ({ id: r.id, sentiment: 'negative', severity: 'high', suspicious_indicators: ['off-topic'], summary: 'Price complaint', recommended_action: 'Reply publicly' })) };
				else if (req.task === 'review_appeal') data = { policy_reason: 'spam', report_text: 'This review promotes another website.' };
				else data = { themes: [{ theme: 'price', mentions: 2, sentiment: 'mixed' }], praise: ['tidy'], complaints: ['price'], observations: [] };
				return { data: data as T, model: 'gpt-5-nano', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, reasoning_tokens: 0 }, cost_usd: 0, tokens_spent: req.tokenCost, ai_call_id: 'x' };
			},
		},
	};
};

const setup = async (bound = true) => {
	const { user } = await createUser('rev@test.dev');
	const org = await ensureOrg(user._id);
	await Organization.updateOne({ _id: org._id }, { $set: { token_balance: 50 } });
	const loc = await createLocation(user._id as Types.ObjectId, { tracking: { keywords: keywordsOf('plumber', 'boiler repair') } });
	if (bound) await UserGBP.create({ user_id: user._id, location_id: loc._id, gbpAccountId: ACC, gbpLocationId: LOC, google_sub: 's' });
	const state: Gbp = { listCalls: [], sent: [] };
	const { ai, calls } = fakeAi();
	let clock = NOW;
	const svc = createReviewsService({ gbp: fakeGbp(state), ai, v4Enabled: true, now: () => clock });
	const reload = async () => (await Location.findById(loc._id)) as ILocation;
	return { svc, state, calls, userId: user._id as Types.ObjectId, reload, tick: (ms: number) => (clock = new Date(clock.getTime() + ms)) };
};

const idOf = async (n: number) => String((await GbpReview.findOne({ review_name: `${ACC}/${LOC}/reviews/r${n}` }).lean())?._id);

describe('refresh (Google, no AI)', () => {
	it('stores reviews with flags and reply state, counts them, never calls AI, and is limited to once per 15 minutes', async () => {
		const { svc, state, calls, reload, tick } = await setup();
		const r = await svc.refresh(await reload());
		expect(r).toMatchObject({ new_reviews: 5, google_calls: 1, stats: { total: 5, positive: 4, negative: 1, unreplied: 4, suspicious: 1 } });
		expect(calls).toHaveLength(0);
		expect(state.listCalls).toEqual([null]);
		expect(await GbpReview.findOne({ review_name: `${ACC}/${LOC}/reviews/r4` }).lean()).toMatchObject({ flag_level: 'suspicious', flags: [{ code: 'link', source: 'system' }] });
		expect(await GbpReview.findOne({ review_name: `${ACC}/${LOC}/reviews/r5` }).lean()).toMatchObject({ reply_state: 'sent' });
		expect((await reload()).summary?.reputation).toMatchObject({ total: 5, awaiting_attention: 2 });
		await expect(svc.refresh(await reload())).rejects.toMatchObject({ statusCode: 429, data: { reason: 'rate_limited' } });
		tick(16 * 60_000);
		await svc.refresh(await reload());
		expect(state.listCalls[1]).toEqual(new Date('2026-09-30T10:00:00Z')); // only newer than the newest stored
	});

	it('needs a GBP binding and v4', async () => {
		const { svc, reload } = await setup(false);
		await expect(svc.refresh(await reload())).rejects.toMatchObject({ statusCode: 400, data: { reason: 'gbp_not_connected' } });
		const off = createReviewsService({ gbp: fakeGbp({ listCalls: [], sent: [] }), ai: fakeAi().ai, v4Enabled: false });
		await expect(off.refresh(await reload())).rejects.toMatchObject({ data: { reason: 'v4_access_pending' } });
	});
});

describe('reply drafts (AI only for eligible 4-5 star reviews)', () => {
	it('drafts only eligible reviews, one batch, charged once; a second request reuses the drafts for free', async () => {
		const { svc, calls, reload, userId } = await setup();
		await svc.refresh(await reload());
		const ids = await Promise.all([1, 2, 3, 4, 5].map(idOf));
		const first = await svc.generateDrafts(await reload(), userId, ids);
		expect(first).toMatchObject({ generated: 2, reused: 0, tokens_spent: 1 });
		expect(first.skipped.map((s) => s.reason).sort()).toEqual(['already_replied', 'flagged', 'rating_not_eligible']);
		expect(calls).toHaveLength(1);
		const input = JSON.parse(calls[0].input) as { reviews: { first_name: string }[]; keywords: string[]; business: { name: string } };
		expect(input.reviews.map((r) => r.first_name)).toEqual(['Reviewer', 'Reviewer']); // first name only
		expect(JSON.stringify(input)).not.toContain('Smith');
		expect(input.keywords).toEqual(['plumber', 'boiler repair']);
		expect(first.drafts[0]).toMatchObject({ reply_state: 'draft', draft: { source: 'ai', stale: false } });
		const again = await svc.generateDrafts(await reload(), userId, ids.slice(0, 2));
		expect(again).toMatchObject({ generated: 0, reused: 2, tokens_spent: 0 });
		expect(calls).toHaveLength(1);
		await svc.generateDrafts(await reload(), userId, ids.slice(0, 1), true);
		expect(calls).toHaveLength(2);
		expect((await reload()).summary?.reputation?.drafts_pending).toBe(2);
	});

	it('user drafts (any rating) are never overwritten without regenerate; send publishes, reports failures, and deletes replies', async () => {
		const { svc, state, calls, reload, userId } = await setup();
		await svc.refresh(await reload());
		const [one, three] = [await idOf(1), await idOf(3)];
		const saved = await svc.saveDraft(await reload(), three, '  Sorry about the price, please call us.  ');
		expect(saved).toMatchObject({ reply_state: 'draft', draft: { text: 'Sorry about the price, please call us.', source: 'user' } });
		await svc.saveDraft(await reload(), one, 'My own words');
		await svc.generateDrafts(await reload(), userId, [one]);
		expect(calls).toHaveLength(0);
		state.failOn = 'r3';
		const two = await idOf(2);
		const sent = await svc.send(await reload(), userId, [one, three, two]);
		expect(sent).toMatchObject({ sent: 1, failed: 1 });
		expect(sent.results.find((r) => r.review_id === two)).toMatchObject({ status: 'skipped', reason: 'no_draft' });
		expect(await GbpReview.findById(one).lean()).toMatchObject({ reply_state: 'sent', reply: { comment: 'My own words' }, draft: null, sent_by: userId });
		expect(await GbpReview.findById(three).lean()).toMatchObject({ reply_state: 'failed', send_error: expect.any(String) });
		expect((await reload()).summary?.reputation?.replies_sent_this_month).toBe(1);
		await svc.deleteReply(await reload(), one);
		expect(await GbpReview.findById(one).lean()).toMatchObject({ reply: null, reply_state: 'none' });
	});
});

describe('analysis, appeals and insights (explicit AI)', () => {
	it('analysis adds AI flags and is cached; appeal drafts only for flagged or low ratings', async () => {
		const { svc, calls, reload, userId } = await setup();
		await svc.refresh(await reload());
		const three = await idOf(3);
		const a = await svc.analyze(await reload(), userId, [three]);
		expect(a).toMatchObject({ analyzed: 1, tokens_spent: 1 });
		expect(a.reviews[0]).toMatchObject({ flag_level: 'suspicious', analysis: { severity: 'high', suspicious_indicators: ['off-topic'] } });
		expect(a.reviews[0].flags.map((f) => f.code)).toEqual(expect.arrayContaining(['ai_suspicious', 'ai_serious']));
		expect((await svc.analyze(await reload(), userId, [three])).tokens_spent).toBe(0);
		await expect(svc.appealDraft(await reload(), userId, await idOf(1))).rejects.toMatchObject({ statusCode: 400, data: { reason: 'not_eligible' } });
		const appeal = await svc.appealDraft(await reload(), userId, three);
		expect(appeal).toMatchObject({ appeal: { policy_reason: 'spam' }, report_url: expect.stringContaining('support.google.com'), tokens_spent: 1 });
		expect((await svc.appealDraft(await reload(), userId, three)).tokens_spent).toBe(0);
		expect(await svc.setReportStatus(await reload(), three, 'reported')).toMatchObject({ report_status: 'reported' });
		expect(calls.map((c) => c.task)).toEqual(['review_analysis', 'review_appeal']);
	});

	it('insights send condensed data once and are stored', async () => {
		const { svc, calls, reload, userId } = await setup();
		await expect(svc.getInsights(await reload())).rejects.toMatchObject({ statusCode: 404, data: { reason: 'no_insights' } });
		await svc.refresh(await reload());
		const r = await svc.generateInsights(await reload(), userId);
		expect(r).toMatchObject({ insight: { praise: ['tidy'] }, basis: { reviews_total: 5, reviews_sent: 5 }, tokens_spent: 2 });
		const input = JSON.parse(calls[0].input) as { excerpts: { text: string }[]; ratings_by_month: unknown[] };
		expect(input.excerpts.every((e) => e.text.length <= 300)).toBe(true);
		expect(input.ratings_by_month).toHaveLength(1);
		expect(await svc.getInsights(await reload())).toMatchObject({ insight: { complaints: ['price'] } });
	});

	it('lists filter and summarise without AI', async () => {
		const { svc, calls, reload } = await setup();
		await svc.refresh(await reload());
		expect((await svc.list(await reload(), { rating: [5] })).total).toBe(3);
		expect((await svc.list(await reload(), { flagged: 'suspicious' })).reviews.map((r) => r.rating)).toEqual([5]);
		expect((await svc.list(await reload(), { replied: false, sort: 'rating_asc' })).reviews[0].rating).toBe(2);
		expect((await svc.list(await reload(), { search: 'boiler' })).total).toBe(1);
		const s = await svc.summary(await reload());
		expect(s).toMatchObject({ stats: { total: 5, average_rating: 4.2 }, ai: { configured: true, token_costs: { reply_drafts_per_10: 1, insights: 2 }, token_balance: 50 } });
		expect(calls).toHaveLength(0);
	});
});
