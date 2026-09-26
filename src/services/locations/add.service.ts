import { Types } from 'mongoose';
import httpStatus from 'http-status';
import logger from '../../configs/logger';
import { PlacesApiError, PlacesClient, PlacesConfigError, placesClient } from '../../clients/placesClient';
import { AddressComponent, PlaceDetailsField } from '../../clients/types/places';
import { Client, ILocation, Location } from '../../models';
import { ApiError, apiErrorWithData } from '../../utils';
import { countryName } from '../gbp/discovery.service';
import { PlacesUsageService, placesUsage } from '../onboarding/usage';
import { OrgContext } from '../org/context';
import { agencyOnly, canWrite, readOnly } from '../org/access';
import { assertCanAddLocation } from '../org/limits';
import { locationHeader } from './locations.service';

// Add a location from a Places search result (Phase 8, path (b) of Decision 2). One Place Details call
// with the minimal fields; no manual entry. Limit-checked, and one place_id per organization.

const DUPLICATE_KEY = 11000;
const NOT_AVAILABLE = 'n/a';

/** Minimal fields to create the location (Enterprise SKU because of phone and website). */
export const ADD_LOCATION_FIELDS: PlaceDetailsField[] = [
	'id',
	'displayName',
	'formattedAddress',
	'addressComponents',
	'location',
	'nationalPhoneNumber',
	'websiteUri',
	'primaryTypeDisplayName',
];

export interface AddFromPlaceInput {
	place_id: string;
	client_id?: string;
}

export interface AddFromPlaceDeps {
	places?: Pick<PlacesClient, 'getPlaceDetails'>;
	usage?: Pick<PlacesUsageService, 'reserve'>;
	now?: () => Date;
}

const part = (components: AddressComponent[], type: string, short = false): string | null => {
	const c = components.find((x) => x.types.includes(type));
	return c ? (short ? c.short : c.long) || null : null;
};

const duplicate = (locationId: unknown) =>
	apiErrorWithData(httpStatus.CONFLICT, 'This business is already one of your locations.', { reason: 'duplicate_place', location_id: String(locationId) });

export const addLocationFromPlace = async (ctx: OrgContext, input: AddFromPlaceInput, deps: AddFromPlaceDeps = {}) => {
	const places = deps.places ?? placesClient;
	const usage = deps.usage ?? placesUsage;
	const now = deps.now ?? (() => new Date());
	if (!canWrite(ctx)) throw readOnly();

	let clientId: Types.ObjectId | null = null;
	if (input.client_id) {
		if (ctx.organization.type !== 'agency') throw agencyOnly();
		const client = await Client.findOne({ _id: input.client_id, organization_id: ctx.organization._id, is_active: true }).select({ _id: 1 }).lean();
		if (!client) throw new ApiError(httpStatus.NOT_FOUND, 'Client not found');
		clientId = client._id as Types.ObjectId;
	}

	const existing = await Location.findOne({ organization_id: ctx.organization._id, is_active: true, place_id: input.place_id }).select({ _id: 1 }).lean();
	if (existing) throw duplicate(existing._id);
	await assertCanAddLocation(ctx.organization);

	await usage.reserve(ctx.userId, 1);
	let details;
	let apiCalls = 0;
	try {
		const result = await places.getPlaceDetails(input.place_id, ADD_LOCATION_FIELDS);
		details = result.details;
		apiCalls = result.apiCalls;
	} catch (err) {
		if (err instanceof PlacesConfigError) throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Places is not configured on this server.');
		if (err instanceof PlacesApiError) {
			if (err.status === 404 || err.status === 400) throw new ApiError(httpStatus.NOT_FOUND, 'Google has no place with this id.');
			throw new ApiError(httpStatus.BAD_GATEWAY, 'Google Places failed. Try again later.');
		}
		throw err;
	}

	const components = details.addressComponents ?? [];
	const region = part(components, 'country', true);
	if (region !== 'US' && region !== 'CA') throw new ApiError(httpStatus.BAD_REQUEST, 'Only US and Canadian businesses are supported.');
	const placeId = details.id ?? input.place_id;
	if (placeId !== input.place_id) {
		// Google returned the place's current id (a moved place): guard that one too.
		const moved = await Location.findOne({ organization_id: ctx.organization._id, is_active: true, place_id: placeId }).select({ _id: 1 }).lean();
		if (moved) throw duplicate(moved._id);
	}
	const lat = details.location?.latitude ?? null;
	const lng = details.location?.longitude ?? null;
	const at = now();

	let location: ILocation;
	try {
		location = await Location.create({
			name: details.displayName ?? NOT_AVAILABLE,
			address: details.formattedAddress ?? NOT_AVAILABLE,
			city: part(components, 'locality') ?? part(components, 'postal_town') ?? part(components, 'sublocality') ?? NOT_AVAILABLE,
			state: part(components, 'administrative_area_level_1', true) ?? NOT_AVAILABLE,
			zip_code: part(components, 'postal_code') ?? NOT_AVAILABLE,
			country: countryName(region) ?? region,
			mobile: details.nationalPhoneNumber ?? NOT_AVAILABLE,
			website_URL: details.websiteUri ?? NOT_AVAILABLE,
			business_category: details.primaryTypeDisplayName ?? NOT_AVAILABLE,
			place_id: placeId,
			lat,
			lng,
			center_source: lat !== null ? 'place_details' : null,
			organization_id: ctx.organization._id,
			client_id: clientId,
			source: 'places_search',
			gbp_connected: false,
			created_by: ctx.userId,
			onboarding: { step: lat !== null ? 'place_selected' : 'center_needed', started_at: at, completed_at: null },
		});
	} catch (err) {
		if ((err as { code?: number }).code === DUPLICATE_KEY) {
			const raced = await Location.findOne({ organization_id: ctx.organization._id, is_active: true, place_id: placeId }).select({ _id: 1 }).lean();
			throw duplicate(raced?._id ?? '');
		}
		throw err;
	}
	logger.info(`locations: location ${String(location._id)} added from Places (organization ${String(ctx.organization._id)})`);
	return { location: await locationHeader(location.toObject() as ILocation), api_calls: apiCalls };
};
