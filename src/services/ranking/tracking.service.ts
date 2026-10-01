import config from '../../configs/config';
import { ILocation, ILocationTracking, Location } from '../../models/location.model';
import { CallEstimate } from '../../ranking';
import { nextOnboardingStep } from '../onboarding/steps';
import { loadEntitlement } from '../billing/entitlement.service';
import { RunPlan, planRun } from './runPlan';
import { CompetitorInfo, competitorInfoService } from './competitorInfo';
import { TrackingUpdate, applyTrackingUpdate, resolveGrid, withDefaults } from './trackingSettings';

// GET / PUT /locations/:locationId/tracking (CLAUDE.md §9.4).

export interface TrackingResponse {
	tracking: ILocationTracking;
	estimate: CallEstimate;
	/** Phase 17: how long a run takes and whether it fits RANK_MAX_CALLS_PER_RUN (a run over it is refused with 422). */
	expected_duration_ms: number;
	cap: number;
	over_cap: boolean;
	dev_capped: boolean;
	/** Phase 17: the tracked competitors with name, address and position (null when unknown). */
	competitors: CompetitorInfo[];
}

const planView = (plan: RunPlan) => ({
	estimate: plan.estimate,
	expected_duration_ms: plan.expectedDurationMs,
	cap: plan.cap,
	over_cap: plan.overCap,
	dev_capped: plan.devCapped,
});

const view = (location: Pick<ILocation, 'lat' | 'lng'>, tracking: ILocationTracking, competitors: CompetitorInfo[]): TrackingResponse => ({
	tracking,
	competitors,
	...planView(planRun(location, tracking)),
});

export interface EstimateQuery {
	size?: number;
	radius_km?: number;
	spacing_km?: number;
	/** A keyword count; default the location's current keywords. */
	keywords?: number;
}

/**
 * Phase 17, GET /locations/:id/tracking/estimate: what a run would need with the given grid and keyword
 * count (default: the saved settings), before saving them. No Google calls. The manual-refresh token cost is
 * flat (the same for every grid).
 */
export const estimateTracking = async (location: ILocation, query: EstimateQuery) => {
	const tracking = withDefaults(location.tracking);
	const grid = query.size !== undefined || query.radius_km !== undefined || query.spacing_km !== undefined
		? resolveGrid({
			size: query.size ?? tracking.grid.size,
			...(query.radius_km !== undefined || query.spacing_km !== undefined
				? { radius_km: query.radius_km, spacing_km: query.spacing_km }
				: { radius_km: tracking.grid.radius_km }),
		})
		: tracking.grid;
	const count = query.keywords ?? Math.max(1, tracking.keywords.length);
	const keywords = Array.from({ length: count }, (_, i) => ({ text: `keyword ${i + 1}`, normalized: `keyword ${i + 1}` }));
	const plan = planRun(location, { ...tracking, grid, keywords });
	const costs = location.organization_id
		? (await loadEntitlement(String(location.organization_id), new Date())).entitlement.tokens.cost_per_refresh
		: null;
	return {
		grid,
		keywords: plan.keywords.length,
		points_per_keyword: plan.estimate.points,
		tracker_offset_km: plan.offsetKm,
		...planView(plan),
		token_cost: { rankings: costs?.rankings ?? 0 },
	};
};

/** GET: stored competitor details, completed from free sources only (no Google call on a page view). */
export const getTracking = async (location: ILocation): Promise<TrackingResponse> => {
	const tracking = withDefaults(location.tracking);
	const { info } = await competitorInfoService.resolve(location, tracking.competitors);
	return view(location, tracking, info);
};

export const updateTracking = async (
	location: ILocation,
	update: TrackingUpdate,
	now: Date = new Date(),
	options: { userId?: string; competitorInfo?: Pick<typeof competitorInfoService, 'resolve'> } = {},
): Promise<TrackingResponse & { keywords_version_bumped: boolean; onboarding_step?: string }> => {
	const { tracking, keywordsVersionBumped } = applyTrackingUpdate(
		withDefaults(location.tracking),
		update,
		location.place_id,
		now,
		config.ranking.maxKeywords,
	);
	// Phase 17: names and positions for the competitors (a Place Details call only for a new one the free
	// sources don't know); saved with the settings.
	const resolver = options.competitorInfo ?? competitorInfoService;
	const { info } = await resolver.resolve(location, tracking.competitors, {
		stored: tracking.competitor_info,
		userId: update.competitors !== undefined ? options.userId : undefined,
	});
	if (update.competitors !== undefined) tracking.competitor_info = info.filter((c) => c.name !== null || c.lat !== null);
	const set: Record<string, unknown> = { tracking };
	// Phase 7a: a tracking update during onboarding advances its step (never backwards).
	const step = nextOnboardingStep(location.onboarding?.step, {
		keywordCount: tracking.keywords.length,
		competitorsSent: update.competitors !== undefined,
	});
	if (step) set['onboarding.step'] = step;
	await Location.updateOne({ _id: location._id }, { $set: set });
	const onboarding = location.onboarding ? { onboarding_step: step ?? location.onboarding.step } : {};
	return { ...view(location, tracking, info), keywords_version_bumped: keywordsVersionBumped, ...onboarding };
};
