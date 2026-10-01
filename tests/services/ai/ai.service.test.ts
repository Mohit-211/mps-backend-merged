import { Types } from 'mongoose';
import { OpenaiError, OpenaiUsage } from '../../../src/clients/openaiClient';
import { AiBudgetDay, AiCall, Organization, TokenLedger } from '../../../src/models';
import { createAiService } from '../../../src/services/ai/ai.service';
import { clearDb, createUser, ensureOrg, startTestDb } from '../../helpers/mongoose';

// Phase 18: the shared AI layer: tokens spent first and refunded on failure, a daily $ cap, a counts-only ledger.

let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
	await AiBudgetDay.syncIndexes();
}, 60000);
afterAll(async () => db.stop());
beforeEach(async () => clearDb());

const usage: OpenaiUsage = { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 500, reasoning_tokens: 0 };
const fakeClient = (fail?: Error) => {
	const calls: unknown[] = [];
	return {
		calls,
		client: {
			isConfigured: () => true,
			respond: async <T>(req: unknown) => {
				calls.push(req);
				if (fail) throw fail;
				return { data: { ok: true } as T, model: 'gpt-5-nano', usage, attempts: 1 };
			},
		},
	};
};
const NOW = new Date('2026-10-02T12:00:00Z');
const org = async (balance: number) => {
	const { user } = await createUser(`ai${Math.random()}@test.dev`);
	const o = await ensureOrg(user._id);
	await Organization.updateOne({ _id: o._id }, { $set: { token_balance: balance } });
	return { orgId: o._id as Types.ObjectId, userId: user._id as Types.ObjectId };
};
const task = (orgId: Types.ObjectId, userId: Types.ObjectId, tokenCost = 2) => ({
	task: 'review_reply_drafts' as const,
	organizationId: orgId,
	userId,
	tokenCost,
	instructions: 'i',
	input: 'x',
	format: { name: 'f', schema: {} },
	maxOutputTokens: 100,
	items: 3,
});

describe('runAiTask', () => {
	it('spends tokens, calls the model once and records counts and cost (no text)', async () => {
		const { orgId, userId } = await org(5);
		const { client, calls } = fakeClient();
		const svc = createAiService({ client, dailyBudgetUsd: 5, now: () => NOW });
		const r = await svc.runAiTask(task(orgId, userId));
		expect(r).toMatchObject({ data: { ok: true }, tokens_spent: 2, model: 'gpt-5-nano' });
		expect(r.cost_usd).toBeCloseTo((1000 * 0.05 + 500 * 0.4) / 1_000_000, 10);
		expect(calls).toHaveLength(1);
		expect((await Organization.findById(orgId).lean())?.token_balance).toBe(3);
		const call = await AiCall.findOne({}).lean();
		expect(call).toMatchObject({ task: 'review_reply_drafts', status: 'ok', ai_model: 'gpt-5-nano', input_tokens: 1000, output_tokens: 500, tokens_spent: 2, items: 3 });
		expect(JSON.stringify(call)).not.toContain('"x"');
		expect(await AiBudgetDay.findOne({ day: '2026-10-02' }).lean()).toMatchObject({ calls: 1 });
	});

	it('402 insufficient_tokens without calling the model', async () => {
		const { orgId, userId } = await org(1);
		const { client, calls } = fakeClient();
		await expect(createAiService({ client, now: () => NOW }).runAiTask(task(orgId, userId))).rejects.toMatchObject({ statusCode: 402, data: { reason: 'insufficient_tokens', balance: 1, cost: 2 } });
		expect(calls).toHaveLength(0);
	});

	it('a failed call is refunded and recorded; 502 ai_failed', async () => {
		const { orgId, userId } = await org(5);
		const { client } = fakeClient(new OpenaiError('OpenAI request failed (500)', { usage }));
		await expect(createAiService({ client, now: () => NOW }).runAiTask(task(orgId, userId))).rejects.toMatchObject({ statusCode: 502, data: { reason: 'ai_failed' } });
		expect((await Organization.findById(orgId).lean())?.token_balance).toBe(5);
		expect(await TokenLedger.countDocuments({ type: 'refund' })).toBe(1);
		expect(await AiCall.findOne({}).lean()).toMatchObject({ status: 'failed', tokens_spent: 0, output_tokens: 500 });
	});

	it('not configured → 503 ai_not_configured; over the daily budget → 503 ai_budget_reached', async () => {
		const { orgId, userId } = await org(5);
		const off = createAiService({ client: { isConfigured: () => false, respond: async () => { throw new Error('never'); } }, now: () => NOW });
		await expect(off.runAiTask(task(orgId, userId))).rejects.toMatchObject({ statusCode: 503, data: { reason: 'ai_not_configured' } });
		await AiBudgetDay.create({ day: '2026-10-02', spent_usd: 1, calls: 9 });
		const { client, calls } = fakeClient();
		await expect(createAiService({ client, dailyBudgetUsd: 1, now: () => NOW }).runAiTask(task(orgId, userId))).rejects.toMatchObject({ statusCode: 503, data: { reason: 'ai_budget_reached' } });
		expect(calls).toHaveLength(0);
		expect((await Organization.findById(orgId).lean())?.token_balance).toBe(5);
	});
});
