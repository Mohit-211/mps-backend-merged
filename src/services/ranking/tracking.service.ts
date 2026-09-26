import config from '../../configs/config';
import { ILocation, ILocationTracking, Location } from '../../models/location.model';
import { CallEstimate } from '../../ranking';
import { nextOnboardingStep } from '../onboarding/steps';
import { planRun } from './runPlan';
import { TrackingUpdate, applyTrackingUpdate, withDefaults } from './trackingSettings';

// GET / PUT /locations/:locationId/tracking (CLAUDE.md §9.4).

export interface TrackingResponse {
	tracking: ILocationTracking;
	estimate: CallEstimate;
	dev_capped: boolean;
}

const view = (location: Pick<ILocation, 'lat' | 'lng'>, tracking: ILocationTracking): TrackingResponse => {
	const plan = planRun(location, tracking);
	return { tracking, estimate: plan.estimate, dev_capped: plan.devCapped };
};

export const getTracking = (location: ILocation): TrackingResponse => view(location, withDefaults(location.tracking));

export const updateTracking = async (
	location: ILocation,
	update: TrackingUpdate,
	now: Date = new Date(),
): Promise<TrackingResponse & { keywords_version_bumped: boolean; onboarding_step?: string }> => {
	const { tracking, keywordsVersionBumped } = applyTrackingUpdate(
		withDefaults(location.tracking),
		update,
		location.place_id,
		now,
		config.ranking.maxKeywords,
	);
	const set: Record<string, unknown> = { tracking };
	// Phase 7a: a tracking update during onboarding advances its step (never backwards).
	const step = nextOnboardingStep(location.onboarding?.step, {
		keywordCount: tracking.keywords.length,
		competitorsSent: update.competitors !== undefined,
	});
	if (step) set['onboarding.step'] = step;
	await Location.updateOne({ _id: location._id }, { $set: set });
	const onboarding = location.onboarding ? { onboarding_step: step ?? location.onboarding.step } : {};
	return { ...view(location, tracking), keywords_version_bumped: keywordsVersionBumped, ...onboarding };
};
