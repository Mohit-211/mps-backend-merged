import { Types } from 'mongoose';
import httpStatus from 'http-status';
import logger from '../../configs/logger';
import { PlacesApiError, PlacesClient, PlacesConfigError, placesClient } from '../../clients/placesClient';
import { ILocation, Location } from '../../models';
import { regionFromCountry } from '../../ranking/region';
import { ApiError } from '../../utils';
import { PlacesUsageService, placesUsage } from './usage';

// Manual business center for service-area businesses (Phase 7a): the user types a city or ZIP; it is
// resolved once with one IDs-only Text Search (free SKU, country region, no location bias) and one
// Place Details call for the `location` field only, then saved as the location's lat/lng
// (center_source 'manual'). Rank runs and competitor suggestions use it like any other center.

export const CENTER_CALLS = 2;

export interface CenterResult {
	lat: number;
	lng: number;
	center_source: 'manual';
	center_label: string;
	api_calls: number;
	onboarding_step?: string;
}

export interface CenterDeps {
	places?: Pick<PlacesClient, 'searchTextIds' | 'getPlaceDetails'>;
	usage?: Pick<PlacesUsageService, 'reserve'>;
}

export const createCenterService = (deps: CenterDeps = {}) => {
	const places = deps.places ?? placesClient;
	const usage = deps.usage ?? placesUsage;

	const setCenter = async (location: ILocation, userId: Types.ObjectId | string, query: string): Promise<CenterResult> => {
		const label = query.trim();
		let region: string;
		try {
			region = regionFromCountry(location.country);
		} catch (err) {
			throw new ApiError(httpStatus.BAD_REQUEST, (err as Error).message);
		}
		await usage.reserve(userId, CENTER_CALLS);

		let apiCalls = 0;
		let lat: number;
		let lng: number;
		try {
			const search = await places.searchTextIds({ textQuery: label, regionCode: region, maxPages: 1 });
			apiCalls += search.apiCalls;
			const top = search.places[0];
			if (!top) throw new ApiError(httpStatus.NOT_FOUND, `No place found for "${label}". Try a city name or ZIP / postal code.`);
			const { details, apiCalls: detailCalls } = await places.getPlaceDetails(top.movedPlaceId ?? top.id, ['location']);
			apiCalls += detailCalls;
			if (!details.location) throw new ApiError(httpStatus.NOT_FOUND, `No coordinates found for "${label}".`);
			lat = details.location.latitude;
			lng = details.location.longitude;
		} catch (err) {
			if (err instanceof ApiError) throw err;
			if (err instanceof PlacesConfigError) throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Places search is not configured on this server.');
			if (err instanceof PlacesApiError) throw new ApiError(httpStatus.BAD_GATEWAY, 'Google Places lookup failed. Try again later.');
			throw err;
		}

		const set: Record<string, unknown> = { lat, lng, center_source: 'manual', center_label: label };
		const advance = location.onboarding?.step === 'center_needed';
		if (advance) set['onboarding.step'] = 'center_set';
		// Suggestions were computed around the old center (if any): drop the cache.
		await Location.updateOne({ _id: location._id }, { $set: set, $unset: { competitor_suggestions: '' } });
		logger.info(`onboarding: manual center set for location ${String(location._id)} (calls=${apiCalls})`);
		return {
			lat,
			lng,
			center_source: 'manual',
			center_label: label,
			api_calls: apiCalls,
			...(location.onboarding ? { onboarding_step: advance ? 'center_set' : location.onboarding.step } : {}),
		};
	};

	return { setCenter };
};

export const centerService = createCenterService();
