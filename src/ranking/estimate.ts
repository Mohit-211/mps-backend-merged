import config from '../configs/config';
import { cacheKey, normaliseKeyword } from './engine';
import { DEFAULT_TRACKER_OFFSET_KM, gridPoints, isGridSize, trackerPoints } from './points';
import { GeoPoint } from './types';

// API-call estimate for one rank run (run caps, the live-test checklist, cost and duration).
// - IDs-only Text Search (free Essentials SKU): per unique point, keyword and sample, 1–3 pages
//   (Phase 12.5: full depth, so 3 unless the market has fewer than 41 results). Unique points =
//   tracker ∪ grid, de-duplicated exactly like the engine's run cache (the center is always shared).
// - Text Search with names (Pro SKU): per keyword, 1 call at each Map Ranking point (5, or the center).
// - Place Details: 1 call if the location has no lat/lng yet (center resolution).
// The client retries once, so every figure can at most double.

export interface EstimateOptions {
	spacingKm?: number;
	offsetKm?: number;
	/** Add the one Place Details call used when the location has no lat/lng yet. */
	includeCenterResolution?: boolean;
	/** Only affects how points coincide at 5 decimals; defaults to a Toronto coordinate. */
	center?: GeoPoint;
	/** Phase 12.5: searches per point (default RANK_SAMPLES_PER_POINT). */
	samples?: number;
	/** Phase 12.5: Map Ranking points per keyword (5 = the tracker points, 1 = the center; default from MAP_RANKING_POINTS). */
	mapPoints?: number;
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
	samples: number;
	mapPoints: number;
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
	const offsetKm = options.offsetKm ?? DEFAULT_TRACKER_OFFSET_KM;
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
	// Defaults follow the configured run (RANK_SAMPLES_PER_POINT, MAP_RANKING_POINTS).
	const samples = options.samples ?? config.ranking.samplesPerPoint;
	const mapPoints = options.mapPoints ?? (config.ranking.mapRankingPoints === 'center' ? 1 : 5);
	const idsOnly = range(points * k * samples, points * k * samples * MAX_PAGES);
	const pro = range(k * mapPoints, k * mapPoints);
	const detailsCount = options.includeCenterResolution ? 1 : 0;
	const details = range(detailsCount, detailsCount);
	const total = range(idsOnly.min + pro.min + details.min, idsOnly.max + pro.max + details.max);
	return { keywords: k, gridSize, points, samples, mapPoints, idsOnly, pro, details, total };
};

export interface DurationOptions {
	/** Places requests per second available to this run (PLACES_MAX_QPS). */
	qps: number;
	samples?: number;
	spacingSec?: number;
}

/**
 * Expected run duration (ms) at full depth: the calls at `qps`, or, when samples are spaced, the
 * spacing between the first and last sample plus one sample round, whichever is longer.
 */
export const estimateDuration = (estimate: Pick<CallEstimate, 'idsOnly' | 'pro' | 'details'>, options: DurationOptions): number => {
	const calls = estimate.idsOnly.max + estimate.pro.max + estimate.details.max;
	const byRate = (calls / Math.max(1, options.qps)) * 1000;
	const samples = options.samples ?? 1;
	const spacingMs = (options.spacingSec ?? 0) * 1000;
	const bySpacing = samples > 1 && spacingMs > 0 ? (samples - 1) * spacingMs + byRate / samples : 0;
	return Math.round(Math.max(byRate, bySpacing));
};
