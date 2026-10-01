import fs from 'fs';
import { USAGE_SKUS, UsageSku } from '../services/usage/skus';

// List prices for the usage ledger (Phase 12.5), in USD per 1,000 calls, and Google's free monthly
// allowance per SKU. Defaults are Google Maps Platform list prices (first volume tier) for the Places
// API (New); verify them on Google's pricing page. Override with a JSON file in PRICING_FILE:
//   { "prices_per_1000": { "places.text.pro": 32, … }, "free_per_month": { "places.text.pro": 5000, … } }
// GBP APIs have no per-call charge.

export interface Pricing {
	prices_per_1000: Record<UsageSku, number>;
	free_per_month: Record<UsageSku, number>;
	source: string;
}

const zero = Object.fromEntries(USAGE_SKUS.map((s) => [s, 0])) as Record<UsageSku, number>;

export const DEFAULT_PRICING: Pricing = {
	prices_per_1000: {
		...zero,
		'places.text.ids_only': 0,
		'places.text.pro': 32,
		'places.text.enterprise': 35,
		'places.details.ids_only': 0,
		'places.details.essentials': 5,
		'places.details.pro': 17,
		'places.details.enterprise': 20,
		'places.details.enterprise_atmosphere': 25,
		'places.autocomplete': 2.83,
	},
	free_per_month: {
		...zero,
		'places.details.essentials': 10_000,
		'places.text.pro': 5_000,
		'places.details.pro': 5_000,
		'places.text.enterprise': 1_000,
		'places.details.enterprise': 1_000,
		'places.details.enterprise_atmosphere': 1_000,
		'places.autocomplete': 10_000,
	},
	source: 'defaults (src/configs/pricing.ts)',
};

export const loadPricing = (file: string | undefined = process.env.PRICING_FILE): Pricing => {
	if (!file) return DEFAULT_PRICING;
	const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Pick<Pricing, 'prices_per_1000' | 'free_per_month'>>;
	return {
		prices_per_1000: { ...DEFAULT_PRICING.prices_per_1000, ...(raw.prices_per_1000 ?? {}) },
		free_per_month: { ...DEFAULT_PRICING.free_per_month, ...(raw.free_per_month ?? {}) },
		source: file,
	};
};

// ---- OpenAI (Phase 18) ----

/** USD per 1M tokens (OpenAI's pricing page, checked 2026-10-02). */
export interface OpenaiPrice {
	input: number;
	cached_input: number;
	output: number;
}

export const OPENAI_PRICES: Record<string, OpenaiPrice> = {
	'gpt-5-nano': { input: 0.05, cached_input: 0.005, output: 0.4 },
	'gpt-5-mini': { input: 0.25, cached_input: 0.025, output: 2 },
	'gpt-4.1-nano': { input: 0.1, cached_input: 0.025, output: 0.4 },
	'gpt-4.1-mini': { input: 0.4, cached_input: 0.1, output: 1.6 },
	'gpt-4o-mini': { input: 0.15, cached_input: 0.075, output: 0.6 },
};

/** An unknown model is costed at the gpt-5-mini rate, so the daily budget errs on the safe side. */
const FALLBACK_OPENAI_PRICE = OPENAI_PRICES['gpt-5-mini'];

/** Estimated USD of one request (reasoning tokens are billed as output and included in output_tokens). */
export const openaiCostUsd = (modelName: string, usage: { input_tokens: number; cached_input_tokens: number; output_tokens: number }): number => {
	const key = Object.keys(OPENAI_PRICES).find((m) => modelName === m || modelName.startsWith(`${m}-`));
	const p = key ? OPENAI_PRICES[key] : FALLBACK_OPENAI_PRICE;
	const uncached = Math.max(0, usage.input_tokens - usage.cached_input_tokens);
	return (uncached * p.input + usage.cached_input_tokens * p.cached_input + usage.output_tokens * p.output) / 1_000_000;
};
