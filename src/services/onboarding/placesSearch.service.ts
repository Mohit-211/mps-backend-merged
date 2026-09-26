import { Types } from 'mongoose';
import httpStatus from 'http-status';
import { PlacesApiError, PlacesClient, PlacesConfigError, placesClient } from '../../clients/placesClient';
import { ILocation, Location } from '../../models';
import { regionFromCountry } from '../../ranking/region';
import { ApiError } from '../../utils';
import { PlacesUsageService, placesUsage } from './usage';

// Places search, one Text Search Pro call (names + addresses, 10 results):
// - Phase 7a manual competitor search, biased to the location's center and region (the location itself
//   is left out of the results);
// - Phase 8 add-location search (no location yet: the organization's country, no bias).

export interface ManualSearchResult {
	results: { place_id: string; name: string | null; address: string | null }[];
	api_calls: number;
}

/** Phase 8: a search to add a location; results already in the organization carry their location_id. */
export interface NewLocationSearchResult {
	results: { place_id: string; name: string | null; address: string | null; already_added: string | null }[];
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

	/**
	 * Phase 8 add-location search: no location yet, so no bias; the region is the requested or the
	 * organization's country (US / CA). One Pro call, counted against the user's daily Places limit.
	 */
	const searchForNewLocation = async (
		organizationId: Types.ObjectId | string,
		country: string | null,
		userId: Types.ObjectId | string,
		q: string,
	): Promise<NewLocationSearchResult> => {
		if (!country) throw new ApiError(httpStatus.BAD_REQUEST, 'Pass country=US or country=CA (the organization has no country).');
		const region = regionFromCountry(country);
		await usage.reserve(userId, 1);
		try {
			const result = await places.searchTextNamesAddresses({ textQuery: q.trim(), regionCode: region });
			const existing = await Location.find({ organization_id: organizationId, is_active: true, place_id: { $in: result.places.map((p) => p.id) } })
				.select({ place_id: 1 })
				.lean();
			const added = new Map(existing.map((l) => [l.place_id, String(l._id)]));
			return {
				results: result.places.map((p) => ({ place_id: p.id, name: p.name, address: p.address, already_added: added.get(p.id) ?? null })),
				api_calls: result.apiCalls,
			};
		} catch (err) {
			if (err instanceof PlacesConfigError) throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Places search is not configured on this server.');
			if (err instanceof PlacesApiError) throw new ApiError(httpStatus.BAD_GATEWAY, 'Google Places search failed. Try again later.');
			throw err;
		}
	};

	return { search, searchForNewLocation };
};

export const placesSearchService = createPlacesSearchService();
