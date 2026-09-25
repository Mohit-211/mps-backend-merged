import config from '../configs/config';
import { cacheKey, normaliseKeyword } from './engine';
import { gridPoints, isGridSize, trackerPoints } from './points';
import { GeoPoint } from './types';

// API-call estimate for one rank run (used by Phase 5 validation and the live-test checklist).
// - IDs-only Text Search (free Essentials SKU): one search per unique point per keyword,
//   1–3 pages each (fewer with stopWhenFound). Unique points = tracker ∪ grid, de-duplicated
//   exactly like the engine's run cache (the center is always shared).
// - Text Search with names (Pro SKU): 1 call per keyword (Map Ranking list at the center).
// - Place Details: 1 call if the location has no lat/lng yet (center resolution).
// The client retries once, so every figure can at most double.

export interface EstimateOptions {
	spacingKm?: number;
	offsetKm?: number;
	/** Add the one Place Details call used when the location has no lat/lng yet. */
	includeCenterResolution?: boolean;
	/** Only affects how points coincide at 5 decimals; defaults to a Toronto coordinate. */
	center?: GeoPoint;
}

export interface CallRange {
	min: number;
	max: number;
	/** max if every call needs its one retry. */
	maxWithRetries: number;
}

export interface CallEstimate {
	keywords: number;
	gridSize: number;
	/** Unique sample points per keyword (tracker ∪ grid). */
	points: number;
	idsOnly: CallRange;
	pro: CallRange;
	details: CallRange;
	total: CallRange;
}

const DEFAULT_CENTER: GeoPoint = { lat: 43.6532, lng: -79.3832 };
const DEFAULT_SPACING_KM = 1;
const MAX_PAGES = 3;

const range = (min: number, max: number): CallRange => ({ min, max, maxWithRetries: max * 2 });

export const countKeywords = (keywords: number | string[]): number => {
	if (typeof keywords === 'number') {
		if (!Number.isInteger(keywords) || keywords < 0) throw new Error(`Invalid keyword count: ${keywords}`);
		return keywords;
	}
	return new Set(keywords.map(normaliseKeyword).filter((k) => k.length > 0)).size;
};

/** Number of distinct points the engine will search per keyword (same keys as its cache). */
export const uniquePointCount = (gridSize: number, options: EstimateOptions = {}): number => {
	const center = options.center ?? DEFAULT_CENTER;
	const offsetKm = options.offsetKm ?? config.ranking.trackerOffsetKm;
	const spacingKm = options.spacingKm ?? DEFAULT_SPACING_KM;
	const keys = new Set(
		[...trackerPoints(center, offsetKm), ...gridPoints(center, gridSize, spacingKm)].map((p) => cacheKey('', p)),
	);
	return keys.size;
};

export const estimateCalls = (
	keywords: number | string[],
	gridSize: number,
	options: EstimateOptions = {},
): CallEstimate => {
	if (!isGridSize(gridSize)) throw new Error(`Invalid grid size: ${gridSize}`);
	const k = countKeywords(keywords);
	const points = uniquePointCount(gridSize, options);
	const idsOnly = range(points * k, points * k * MAX_PAGES);
	const pro = range(k, k);
	const detailsCount = options.includeCenterResolution ? 1 : 0;
	const details = range(detailsCount, detailsCount);
	const total = range(idsOnly.min + pro.min + details.min, idsOnly.max + pro.max + details.max);
	return { keywords: k, gridSize, points, idsOnly, pro, details, total };
};
