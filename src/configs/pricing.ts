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
