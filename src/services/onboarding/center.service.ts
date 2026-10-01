import { Types } from 'mongoose';
import httpStatus from 'http-status';
import logger from '../../configs/logger';
import { PlacesApiError, PlacesClient, PlacesConfigError, placesClient } from '../../clients/placesClient';
import { AutocompleteSuggestion } from '../../clients/types/places';
import { LIMITS, hit } from '../auth/rateLimit';
import { ILocation, Location } from '../../models';
import { regionFromCountry } from '../../ranking/region';
import { ApiError } from '../../utils';
import { PlacesUsageService, placesUsage } from './usage';

// Manual business center for service-area businesses (Phase 7a): the user types a city or ZIP; it is
// resolved once with one IDs-only Text Search (free SKU, country region, no location bias) and one
// Place Details call for the `location` field only, then saved as the location's lat/lng
// (center_source 'manual'). Rank runs and competitor suggestions use it like any other center.
// 2026-10-01: the city / ZIP picker. GET /places/autocomplete (Autocomplete (New), regions and postal codes in
// the country, one session token per picker) and PUT /locations/:id/center { place_id, session } (one Place
// Details Essentials call: location + formattedAddress, ending the session). A session counts 1 toward the
// daily Places limit (charged on the pick); the keystrokes are rate-limited per user.

/** Google's "(regions)" collection: localities, sublocalities, postal codes, admin areas. */
export const CENTER_AUTOCOMPLETE_TYPES = ['(regions)'];

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
	places?: Pick<PlacesClient, 'searchTextIds' | 'getPlaceDetails'> & Partial<Pick<PlacesClient, 'autocomplete'>>;
	usage?: Pick<PlacesUsageService, 'reserve'>;
	/** Counts one autocomplete request per user (throws 429 rate_limited); default the Mongo limiter. */
	rateLimit?: (userId: string) => Promise<void>;
}

const placesError = (err: unknown): never => {
	if (err instanceof ApiError) throw err;
	if (err instanceof PlacesConfigError) throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Places search is not configured on this server.');
	if (err instanceof PlacesApiError) throw new ApiError(httpStatus.BAD_GATEWAY, 'Google Places lookup failed. Try again later.');
	throw err;
};

export const createCenterService = (deps: CenterDeps = {}) => {
	const places = deps.places ?? placesClient;
	const usage = deps.usage ?? placesUsage;
	const rateLimit = deps.rateLimit ?? ((userId: string) => hit(LIMITS.placesAutocompletePerUser, [userId]).then(() => undefined));

	const save = async (location: ILocation, lat: number, lng: number, label: string, apiCalls: number): Promise<CenterResult> => {
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

	const regionOrBadRequest = (country: string | null | undefined): string => {
		try {
			return regionFromCountry(country);
		} catch (err) {
			throw new ApiError(httpStatus.BAD_REQUEST, (err as Error).message);
		}
	};

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
			placesError(err);
			throw err;
		}

		return save(location, lat, lng, label, apiCalls);
	};

	/** Suggestions for the picker: cities, regions and postal codes in the country. Not charged to the daily limit. */
	const autocomplete = async (userId: string, input: string, country: string, sessionToken: string): Promise<{ suggestions: AutocompleteSuggestion[] }> => {
		const region = regionOrBadRequest(country);
		await rateLimit(userId);
		try {
			const run = places.autocomplete ?? placesClient.autocomplete;
			const { suggestions } = await run({ input, regionCodes: [region], sessionToken, includedPrimaryTypes: CENTER_AUTOCOMPLETE_TYPES });
			return { suggestions };
		} catch (err) {
			return placesError(err);
		}
	};

	/** The picked suggestion becomes the center (1 Place Details Essentials call; ends the session). */
	const setCenterFromPlace = async (location: ILocation, userId: Types.ObjectId | string, placeId: string, sessionToken?: string): Promise<CenterResult> => {
		regionOrBadRequest(location.country);
		await usage.reserve(userId, 1);
		let lat: number;
		let lng: number;
		let label: string;
		let apiCalls = 0;
		try {
			const { details, apiCalls: calls } = await places.getPlaceDetails(placeId, ['location', 'formattedAddress'], { sessionToken });
			apiCalls += calls;
			if (!details.location) throw new ApiError(httpStatus.NOT_FOUND, 'No coordinates found for that place.');
			lat = details.location.latitude;
			lng = details.location.longitude;
			label = details.formattedAddress ?? placeId;
		} catch (err) {
			placesError(err);
			throw err;
		}
		return save(location, lat, lng, label, apiCalls);
	};

	return { setCenter, setCenterFromPlace, autocomplete };
};

export const centerService = createCenterService();
