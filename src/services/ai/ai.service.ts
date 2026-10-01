import httpStatus from 'http-status';
import { Types } from 'mongoose';
import config from '../../configs/config';
import logger from '../../configs/logger';
import { openaiCostUsd } from '../../configs/pricing';
import { JsonSchemaFormat, OpenaiClient, OpenaiConfigError, OpenaiError, OpenaiUsage, openaiClient } from '../../clients/openaiClient';
import { AiBudgetDay, AiCall, AiTask } from '../../models/aiCall.model';
import { apiErrorWithData } from '../../utils';
import { refundSpend, spend } from '../billing/tokens';

// The shared AI layer (Phase 18, 2026-10-02): every feature that uses OpenAI goes through runAiTask, which
// owns the rules so features can't forget them:
// 1. AI must be configured (503 ai_not_configured) and under the server-wide daily budget (503 ai_budget_reached).
// 2. The organization pays `tokenCost` MyPageSEO tokens first (402 insufficient_tokens); a failed call is refunded.
// 3. Every request is recorded in the AiCall ledger (counts and estimated USD only, never prompts or text).
// Features call it only on an explicit user action and cache what it returns.

type Id = Types.ObjectId | string;

export interface AiTaskRequest {
	task: AiTask;
	organizationId: Id;
	locationId?: Id | null;
	userId?: Id | null;
	/** MyPageSEO tokens this request costs (0 = free). */
	tokenCost: number;
	instructions: string;
	input: string;
	format: JsonSchemaFormat;
	maxOutputTokens: number;
	/** How many items (reviews…) the request covers, for the ledger. */
	items?: number;
}

export interface AiTaskResult<T> {
	data: T;
	model: string;
	usage: OpenaiUsage;
	cost_usd: number;
	tokens_spent: number;
	ai_call_id: string;
}

export interface AiDeps {
	client?: Pick<OpenaiClient, 'respond' | 'isConfigured'>;
	dailyBudgetUsd?: number;
	now?: () => Date;
}

const dayOf = (d: Date): string => d.toISOString().slice(0, 10);

export const createAiService = (deps: AiDeps = {}) => {
	const client = deps.client ?? openaiClient;
	const budget = () => deps.dailyBudgetUsd ?? config.ai.dailyBudgetUsd;
	const now = deps.now ?? (() => new Date());

	const notConfigured = () => apiErrorWithData(httpStatus.SERVICE_UNAVAILABLE, 'AI is not configured on this server.', { reason: 'ai_not_configured' });

	/** True when AI can be used right now (configured and under today's budget). */
	const status = async (): Promise<{ configured: boolean; budget_reached: boolean }> => {
		const configured = client.isConfigured() && budget() > 0;
		if (!configured) return { configured: false, budget_reached: false };
		const today = await AiBudgetDay.findOne({ day: dayOf(now()) }).lean();
		return { configured: true, budget_reached: (today?.spent_usd ?? 0) >= budget() };
	};

	const addSpend = async (at: Date, usd: number) => {
		await AiBudgetDay.updateOne({ day: dayOf(at) }, { $inc: { spent_usd: usd, calls: 1 } }, { upsert: true });
	};

	const runAiTask = async <T>(req: AiTaskRequest): Promise<AiTaskResult<T>> => {
		const st = await status();
		if (!st.configured) throw notConfigured();
		if (st.budget_reached) {
			throw apiErrorWithData(httpStatus.SERVICE_UNAVAILABLE, 'AI is paused for today (daily budget reached). Try again tomorrow.', { reason: 'ai_budget_reached' });
		}
		const callId = new Types.ObjectId();
		const ref = `ai_call:${String(callId)}`;
		const startedAt = now();
		const paid = await spend(req.organizationId, req.tokenCost, {
			ref,
			location_id: req.locationId ?? null,
			actor: req.userId ? { kind: 'user', id: new Types.ObjectId(String(req.userId)), name: null } : undefined,
			note: `AI: ${req.task.replace(/_/g, ' ')}`,
		});
		if (!paid.ok) {
			throw apiErrorWithData(httpStatus.PAYMENT_REQUIRED, 'Not enough tokens for this AI action.', { reason: 'insufficient_tokens', balance: paid.balance, cost: req.tokenCost });
		}
		const record = async (status: 'ok' | 'failed', model: string, usage: OpenaiUsage | null, error: string | null, tokensSpent: number) => {
			const cost = usage ? openaiCostUsd(model, usage) : 0;
			await AiCall.create({
				_id: callId,
				task: req.task,
				organization_id: req.organizationId,
				location_id: req.locationId ?? null,
				user_id: req.userId ?? null,
				ai_model: model,
				status,
				error,
				input_tokens: usage?.input_tokens ?? 0,
				cached_input_tokens: usage?.cached_input_tokens ?? 0,
				output_tokens: usage?.output_tokens ?? 0,
				reasoning_tokens: usage?.reasoning_tokens ?? 0,
				cost_usd: cost,
				tokens_spent: tokensSpent,
				items: req.items ?? 0,
				duration_ms: now().getTime() - startedAt.getTime(),
				at: startedAt,
			});
			if (cost > 0) await addSpend(startedAt, cost);
			return cost;
		};
		try {
			const result = await client.respond<T>({ instructions: req.instructions, input: req.input, format: req.format, maxOutputTokens: req.maxOutputTokens });
			const cost = await record('ok', result.model, result.usage, null, req.tokenCost);
			return { data: result.data, model: result.model, usage: result.usage, cost_usd: cost, tokens_spent: req.tokenCost, ai_call_id: String(callId) };
		} catch (err) {
			const refunded = await refundSpend(ref, `Refund: AI ${req.task.replace(/_/g, ' ')} failed`);
			if (err instanceof OpenaiConfigError) {
				await record('failed', config.ai.model, null, 'not_configured', req.tokenCost - refunded);
				throw notConfigured();
			}
			if (err instanceof OpenaiError) {
				await record('failed', config.ai.model, err.usage, err.message, req.tokenCost - refunded);
				logger.warn(`ai: ${req.task} failed for organization ${String(req.organizationId)}: ${err.message}`);
				throw apiErrorWithData(httpStatus.BAD_GATEWAY, 'The AI service did not answer. No tokens were spent; try again.', { reason: 'ai_failed' });
			}
			throw err;
		}
	};

	return { runAiTask, status };
};

export const aiService = createAiService();
