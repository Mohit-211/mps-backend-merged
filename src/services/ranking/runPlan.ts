import config from '../../configs/config';
import { ILocationTracking } from '../../models/location.model';
import { CallEstimate, applyDevKeywordCap, estimateCalls, estimateDuration, radiusFromSpacing, trackerOffsetForRadius } from '../../ranking';

// What a rank run for a location would do right now, and what it would cost (CLAUDE.md §9.3,
// Mohit's Phase 5 point 5). Used by "run now", the scheduler and GET tracking.

export interface RunPlanOptions {
	env?: string;
	devMaxKeywords?: number;
	maxCallsPerRun?: number;
	offsetKm?: number;
	radiusM?: number;
	samples?: number;
	sampleSpacingSec?: number;
	mapRankingPoints?: 'all' | 'center';
	qps?: number;
}

export interface RunPlan {
	keywords: ILocationTracking['keywords'];
	gridSize: number;
	spacingKm: number;
	/** Phase 17: the grid's center-to-edge distance. */
	radiusKm: number;
	/** Rank Tracker / Map Ranking offset: radius ÷ 2, at least 0.5 km (Phase 17). */
	offsetKm: number;
	radiusM: number;
	/** Phase 12.5: samples per point, their spacing, Map Ranking points (5 or 1), expected duration. */
	samples: number;
	sampleSpacingSec: number;
	mapPoints: number;
	expectedDurationMs: number;
	/** Keywords or grid reduced by the development limits (RANK_DEV_MAX_KEYWORDS, 3×3). */
	devCapped: boolean;
	needsCenterResolution: boolean;
	estimate: CallEstimate;
	cap: number;
	overCap: boolean;
}

const hasCenter = (location: { lat?: number | null; lng?: number | null }): boolean =>
	Number.isFinite(location.lat) && Number.isFinite(location.lng);

export const planRun = (
	location: { lat?: number | null; lng?: number | null },
	tracking: ILocationTracking,
	options: RunPlanOptions = {},
): RunPlan => {
	const env = options.env ?? config.essentials.env;
	const cap = options.maxCallsPerRun ?? config.ranking.maxCallsPerRun;
	const radiusM = options.radiusM ?? config.ranking.searchRadiusM;
	const samples = options.samples ?? config.ranking.samplesPerPoint;
	const sampleSpacingSec = options.sampleSpacingSec ?? config.ranking.sampleSpacingSec;
	const mapPoints = (options.mapRankingPoints ?? config.ranking.mapRankingPoints) === 'center' ? 1 : 5;

	const capped = applyDevKeywordCap(tracking.keywords, env, options.devMaxKeywords ?? config.ranking.devMaxKeywords);
	const isDev = env === 'development';
	const gridSize = isDev ? 3 : tracking.grid.size;
	const devCapped = capped.capped || (isDev && tracking.grid.size !== 3);
	// The development 3×3 keeps the spacing, so its radius shrinks with it.
	const radiusKm = gridSize === tracking.grid.size && tracking.grid.radius_km !== undefined
		? tracking.grid.radius_km
		: radiusFromSpacing(gridSize, tracking.grid.spacing_km);
	const offsetKm = options.offsetKm ?? trackerOffsetForRadius(radiusKm);
	const needsCenterResolution = !hasCenter(location);

	const estimate = estimateCalls(
		capped.keywords.map((k) => k.normalized),
		gridSize,
		{
			spacingKm: tracking.grid.spacing_km,
			offsetKm,
			includeCenterResolution: needsCenterResolution,
			center: needsCenterResolution ? undefined : { lat: location.lat as number, lng: location.lng as number },
			samples,
			mapPoints,
		},
	);
	const expectedDurationMs = estimateDuration(estimate, { qps: options.qps ?? config.ranking.placesMaxQps, samples, spacingSec: sampleSpacingSec });

	return {
		keywords: capped.keywords,
		gridSize,
		spacingKm: tracking.grid.spacing_km,
		radiusKm,
		offsetKm,
		radiusM,
		samples,
		sampleSpacingSec,
		mapPoints,
		expectedDurationMs,
		devCapped,
		needsCenterResolution,
		estimate,
		cap,
		overCap: estimate.idsOnly.max > cap,
	};
};
