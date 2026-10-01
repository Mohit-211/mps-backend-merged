import config from '../configs/config';
import logger from '../configs/logger';
import { HttpRequestError, HttpTransport, Sleep, createAxiosTransport, defaultSleep, isTransportError, toHttpRequestError, withRetry } from './http';

// OpenAI Responses API (Phase 18, 2026-10-02): the only place that talks to OpenAI. Every call asks for a
// structured JSON answer (json_schema, strict), sends no conversation state (store: false) and logs counts
// only, never prompts, outputs or keys. Business rules (who may call, tokens, budgets) live in
// services/ai/ai.service.ts, not here.

const BASE_URL = 'https://api.openai.com/v1';
/** AI answers take longer than Google calls. */
const AI_TIMEOUT_MS = 60_000;

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium';

export interface JsonSchemaFormat {
	/** Schema name (letters, digits, _ and -). */
	name: string;
	schema: Record<string, unknown>;
}

export interface OpenaiRequest {
	/** Fixed instructions (the system prompt). */
	instructions: string;
	/** The task input, usually compact JSON. */
	input: string;
	format: JsonSchemaFormat;
	maxOutputTokens: number;
	model?: string;
	reasoningEffort?: ReasoningEffort;
}

export interface OpenaiUsage {
	input_tokens: number;
	cached_input_tokens: number;
	output_tokens: number;
	reasoning_tokens: number;
}

export interface OpenaiResult<T> {
	data: T;
	model: string;
	usage: OpenaiUsage;
	attempts: number;
}

export class OpenaiConfigError extends Error {
	constructor() {
		super('OPENAI_API_KEY not set');
		this.name = 'OpenaiConfigError';
	}
}

/** The call failed (HTTP error, timeout, refusal, cut-off or unparsable output); `usage` is what was billed, if known. */
export class OpenaiError extends Error {
	readonly status?: number;
	readonly attempts: number;
	readonly usage: OpenaiUsage | null;
	constructor(message: string, opts: { status?: number; attempts?: number; usage?: OpenaiUsage | null } = {}) {
		super(message);
		this.name = 'OpenaiError';
		this.status = opts.status;
		this.attempts = opts.attempts ?? 1;
		this.usage = opts.usage ?? null;
	}
}

interface RawResponse {
	model?: string;
	status?: string;
	incomplete_details?: { reason?: string } | null;
	output?: { type?: string; content?: { type?: string; text?: string; refusal?: string }[] }[];
	usage?: {
		input_tokens?: number;
		input_tokens_details?: { cached_tokens?: number };
		output_tokens?: number;
		output_tokens_details?: { reasoning_tokens?: number };
	};
}

const usageOf = (raw: RawResponse): OpenaiUsage => ({
	input_tokens: raw.usage?.input_tokens ?? 0,
	cached_input_tokens: raw.usage?.input_tokens_details?.cached_tokens ?? 0,
	output_tokens: raw.usage?.output_tokens ?? 0,
	reasoning_tokens: raw.usage?.output_tokens_details?.reasoning_tokens ?? 0,
});

export interface OpenaiClientOptions {
	apiKey?: string;
	model?: string;
	reasoningEffort?: ReasoningEffort;
	transport?: HttpTransport;
	sleep?: Sleep;
	retryBaseDelayMs?: number;
}

export type OpenaiClient = ReturnType<typeof createOpenaiClient>;

export const createOpenaiClient = (options: OpenaiClientOptions = {}) => {
	const transport = options.transport ?? createAxiosTransport(AI_TIMEOUT_MS);
	const sleep = options.sleep ?? defaultSleep;

	const isConfigured = (): boolean => Boolean(options.apiKey);

	/** One structured-output request. Throws OpenaiConfigError without a key and OpenaiError on any failure. */
	const respond = async <T>(req: OpenaiRequest): Promise<OpenaiResult<T>> => {
		if (!options.apiKey) throw new OpenaiConfigError();
		const model = req.model ?? options.model ?? 'gpt-5-nano';
		const effort = req.reasoningEffort ?? options.reasoningEffort ?? 'minimal';
		const body = {
			model,
			instructions: req.instructions,
			input: req.input,
			max_output_tokens: req.maxOutputTokens,
			store: false,
			...(effort === 'none' ? {} : { reasoning: { effort } }),
			text: { format: { type: 'json_schema', name: req.format.name, schema: req.format.schema, strict: true } },
		};
		const started = Date.now();
		let raw: RawResponse;
		let attempts = 1;
		try {
			const result = await withRetry(
				() =>
					transport<RawResponse>({
						method: 'POST',
						url: `${BASE_URL}/responses`,
						headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.apiKey}` },
						data: body,
					}),
				{ sleep, baseDelayMs: options.retryBaseDelayMs ?? 1000 },
			);
			raw = result.value.data;
			attempts = result.attempts;
		} catch (err) {
			if (!isTransportError(err) && !(err instanceof HttpRequestError)) throw err;
			const error = toHttpRequestError(err);
			logger.warn(`openai ${req.format.name} failed status=${error.status ?? error.code} attempts=${error.attempts} ${Date.now() - started}ms`);
			throw new OpenaiError(`OpenAI request failed (${error.status ?? error.code})`, { status: error.status, attempts: error.attempts });
		}
		const usage = usageOf(raw);
		logger.debug(`openai ${req.format.name} model=${raw.model ?? model} in=${usage.input_tokens} out=${usage.output_tokens} ${Date.now() - started}ms`);
		if (raw.status === 'incomplete') {
			throw new OpenaiError(`OpenAI answer cut off (${raw.incomplete_details?.reason ?? 'incomplete'})`, { attempts, usage });
		}
		const content = (raw.output ?? []).filter((o) => o.type === 'message').flatMap((o) => o.content ?? []);
		if (content.some((c) => c.type === 'refusal')) throw new OpenaiError('OpenAI refused the request', { attempts, usage });
		const text = content.find((c) => c.type === 'output_text')?.text;
		if (!text) throw new OpenaiError('OpenAI returned no output', { attempts, usage });
		let data: T;
		try {
			data = JSON.parse(text) as T;
		} catch {
			throw new OpenaiError('OpenAI returned invalid JSON', { attempts, usage });
		}
		return { data, model: raw.model ?? model, usage, attempts };
	};

	return { respond, isConfigured };
};

/** Default client configured from the environment. */
export const openaiClient: OpenaiClient = createOpenaiClient({
	apiKey: config.ai.openaiApiKey,
	model: config.ai.model,
	reasoningEffort: config.ai.reasoningEffort,
});
