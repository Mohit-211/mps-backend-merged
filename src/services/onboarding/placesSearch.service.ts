import { Types } from 'mongoose';
import httpStatus from 'http-status';
import { PlacesApiError, PlacesClient, PlacesConfigError, placesClient } from '../../clients/placesClient';
import { ILocation } from '../../models';
import { regionFromCountry } from '../../ranking/region';
import { ApiError } from '../../utils';
import { PlacesUsageService, placesUsage } from './usage';

// Manual competitor search (Phase 7a): one Text Search Pro call (names + addresses, 10 results),
// biased to the location's center and region. The location itself is left out of the results.

export interface ManualSearchResult {
	results: { place_id: string; name: string | null; address: string | null }[];
	api_calls: number;
}

export interface PlacesSearchDeps {
	places?: Pick<PlacesClient, 'searchTextNamesAddresses'>;
	usage?: Pick<PlacesUsageService, 'reserve'>;
}

export const createPlacesSearchService = (deps: PlacesSearchDeps = {}) => {
	const places = deps.places ?? placesClient;
	const usage = deps.usage ?? placesUsage;

	const search = async (location: ILocation, userId: Types.ObjectId | string, q: string): Promise<ManualSearchResult> => {
		if (typeof location.lat !== 'number' || typeof location.lng !== 'number') {
			throw new ApiError(httpStatus.BAD_REQUEST, 'This location has no coordinates yet.');
		}
		let region: string;
		try {
			region = regionFromCountry(location.country);
		} catch (err) {
			throw new ApiError(httpStatus.BAD_REQUEST, (err as Error).message);
		}
		await usage.reserve(userId, 1);
		try {
			const result = await places.searchTextNamesAddresses({
				textQuery: q.trim(),
				regionCode: region,
				center: { latitude: location.lat, longitude: location.lng },
			});
			return {
				results: result.places
					.filter((p) => p.id !== location.place_id)
					.map((p) => ({ place_id: p.id, name: p.name, address: p.address })),
				api_calls: result.apiCalls,
			};
		} catch (err) {
			if (err instanceof PlacesConfigError) throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Places search is not configured on this server.');
			if (err instanceof PlacesApiError) throw new ApiError(httpStatus.BAD_GATEWAY, 'Google Places search failed. Try again later.');
			throw err;
		}
	};

	return { search };
};

export const placesSearchService = createPlacesSearchService();
