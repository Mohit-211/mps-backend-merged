import config from '../../configs/config';
import { ILocationTracking } from '../../models/location.model';
import { CallEstimate, applyDevKeywordCap, estimateCalls } from '../../ranking';

// What a rank run for a location would do right now, and what it would cost (CLAUDE.md §9.3,
// Mohit's Phase 5 point 5). Used by "run now", the scheduler and GET tracking.

export interface RunPlanOptions {
	env?: string;
	devMaxKeywords?: number;
	maxCallsPerRun?: number;
	offsetKm?: number;
	radiusM?: number;
}

export interface RunPlan {
	keywords: ILocationTracking['keywords'];
	gridSize: number;
	spacingKm: number;
	offsetKm: number;
	radiusM: number;
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
	const offsetKm = options.offsetKm ?? config.ranking.trackerOffsetKm;
	const radiusM = options.radiusM ?? config.ranking.searchRadiusM;

	const capped = applyDevKeywordCap(tracking.keywords, env, options.devMaxKeywords ?? config.ranking.devMaxKeywords);
	const isDev = env === 'development';
	const gridSize = isDev ? 3 : tracking.grid.size;
	const devCapped = capped.capped || (isDev && tracking.grid.size !== 3);
	const needsCenterResolution = !hasCenter(location);

	const estimate = estimateCalls(
		capped.keywords.map((k) => k.normalized),
		gridSize,
		{
			spacingKm: tracking.grid.spacing_km,
			offsetKm,
			includeCenterResolution: needsCenterResolution,
			center: needsCenterResolution ? undefined : { lat: location.lat as number, lng: location.lng as number },
		},
	);

	return {
		keywords: capped.keywords,
		gridSize,
		spacingKm: tracking.grid.spacing_km,
		offsetKm,
		radiusM,
		devCapped,
		needsCenterResolution,
		estimate,
		cap,
		overCap: estimate.idsOnly.max > cap,
	};
};
