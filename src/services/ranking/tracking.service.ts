import config from '../../configs/config';
import { ILocation, ILocationTracking, Location } from '../../models/location.model';
import { CallEstimate } from '../../ranking';
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
): Promise<TrackingResponse & { keywords_version_bumped: boolean }> => {
	const { tracking, keywordsVersionBumped } = applyTrackingUpdate(
		withDefaults(location.tracking),
		update,
		location.place_id,
		now,
		config.ranking.maxKeywords,
	);
	await Location.updateOne({ _id: location._id }, { $set: { tracking } });
	return { ...view(location, tracking), keywords_version_bumped: keywordsVersionBumped };
};
