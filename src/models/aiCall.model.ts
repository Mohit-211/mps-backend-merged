import { Document, Model, Schema, Types, model } from 'mongoose';

// The AI ledger (Phase 18): one row per OpenAI request, counts and estimated cost only. No prompt, no
// output, no review text is stored here. AiBudgetDay is the server-wide daily spend counter.

export const AI_TASKS = ['review_reply_drafts', 'review_analysis', 'review_appeal', 'review_insights'] as const;
export type AiTask = (typeof AI_TASKS)[number];

export interface IAiCall extends Document {
	task: AiTask;
	organization_id: Types.ObjectId;
	location_id: Types.ObjectId | null;
	user_id: Types.ObjectId | null;
	ai_model: string;
	status: 'ok' | 'failed';
	error: string | null;
	input_tokens: number;
	cached_input_tokens: number;
	output_tokens: number;
	reasoning_tokens: number;
	cost_usd: number;
	/** MyPageSEO tokens spent (0 when refunded after a failure). */
	tokens_spent: number;
	/** How many items (e.g. reviews) the request covered. */
	items: number;
	duration_ms: number;
	at: Date;
}

const AiCallSchema = new Schema<IAiCall>(
	{
		task: { type: String, enum: AI_TASKS, required: true },
		organization_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
		location_id: { type: Schema.Types.ObjectId, ref: 'Location', default: null },
		user_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
		ai_model: { type: String, required: true },
		status: { type: String, enum: ['ok', 'failed'], required: true },
		error: { type: String, default: null },
		input_tokens: { type: Number, default: 0 },
		cached_input_tokens: { type: Number, default: 0 },
		output_tokens: { type: Number, default: 0 },
		reasoning_tokens: { type: Number, default: 0 },
		cost_usd: { type: Number, default: 0 },
		tokens_spent: { type: Number, default: 0 },
		items: { type: Number, default: 0 },
		duration_ms: { type: Number, default: 0 },
		at: { type: Date, required: true },
	},
	{ collection: 'ai_calls' },
);
AiCallSchema.index({ organization_id: 1, at: -1 });
AiCallSchema.index({ at: -1 });

export const AiCall: Model<IAiCall> = model<IAiCall>('AiCall', AiCallSchema);

export interface IAiBudgetDay extends Document {
	/** UTC day "YYYY-MM-DD". */
	day: string;
	spent_usd: number;
	calls: number;
}

const AiBudgetDaySchema = new Schema<IAiBudgetDay>(
	{
		day: { type: String, required: true },
		spent_usd: { type: Number, default: 0 },
		calls: { type: Number, default: 0 },
	},
	{ collection: 'ai_budget_days' },
);
AiBudgetDaySchema.index({ day: 1 }, { unique: true });

export const AiBudgetDay: Model<IAiBudgetDay> = model<IAiBudgetDay>('AiBudgetDay', AiBudgetDaySchema);
