import { Types } from 'mongoose';
import httpStatus from 'http-status';
import logger from '../../configs/logger';
import { tokenTypes } from '../../configs/constantTypes';
import { GbpClient, gbpClient } from '../../clients/gbpClient';
import { GbpLocation } from '../../clients/types/gbp';
import { ILocation, Location, Profile, RankRun, UserGBP } from '../../models';
import { ApiError } from '../../utils';
import { BindResult, bindingService } from '../gbp/binding.service';
import { DiscoveredLocation, countryName, discoveryService, formatAddress } from '../gbp/discovery.service';
import { toGbpApiError } from '../gbp/errors';
import { TokenStore, tokenStore } from '../gbp/tokenStore';
import { EnqueueResult, RunOverCapError, enqueueRankRun } from '../ranking/rankRun.service';
import { withDefaults } from '../ranking/trackingSettings';

// Onboarding (Phase 7a): connect Google → pick a Business Profile (creates or links our Location and
// binds it) → keywords → competitors → complete (first rank run + a GBP sync request for Phase 7b).

export const SUPPORTED_REGIONS = ['US', 'CA'];
const NOT_AVAILABLE = 'n/a';

type UserId = Types.ObjectId | string;

export interface OnboardingState {
	gbp: { connected: boolean; google_email: string | null; status: 'active' | 'revoked' | 'none' | 'unreadable' };
	locations: { location_id: string; name: string; onboarding: ILocation['onboarding'] }[];
}

export interface SelectProfileInput {
	gbpAccountId: string;
	gbpLocationId: string;
	location_id?: string;
}

export interface SelectProfileResult {
	location: { location_id: string; name: string; address: string; place_id: string | null; lat: number | null; lng: number | null };
	created: boolean;
	binding: BindResult;
}

export interface CompleteResult {
	completed: true;
	completed_at: Date;
	rank_run: { run_id: string; status: string; existing: boolean } | null;
	gbp_sync: { requested_at: Date | null };
}

export interface OnboardingDeps {
	client?: Pick<GbpClient, 'getLocation'>;
	tokens?: Pick<TokenStore, 'load'>;
	discovery?: { listAllLocations: typeof discoveryService.listAllLocations };
	binding?: { bindLocation: typeof bindingService.bindLocation };
	enqueue?: (location: ILocation, userId: UserId) => Promise<EnqueueResult>;
	now?: () => Date;
}

const regionOf = (profile: GbpLocation): string | null => profile.storefrontAddress?.regionCode ?? profile.serviceAreaRegionCode;

/** Location fields from a GBP profile (required text fields fall back to "n/a"). */
export const locationFieldsFromProfile = (profile: GbpLocation) => {
	const address = profile.storefrontAddress;
	return {
		name: profile.title ?? NOT_AVAILABLE,
		address: formatAddress(address) ?? 'Service-area business',
		city: address?.locality ?? NOT_AVAILABLE,
		state: address?.administrativeArea ?? NOT_AVAILABLE,
		zip_code: address?.postalCode ?? NOT_AVAILABLE,
		country: countryName(regionOf(profile)) ?? NOT_AVAILABLE,
		mobile: profile.primaryPhone ?? NOT_AVAILABLE,
		website_URL: profile.websiteUri ?? NOT_AVAILABLE,
		business_category: profile.primaryCategory ?? NOT_AVAILABLE,
		place_id: profile.placeId,
		lat: profile.latlng?.latitude ?? null,
		lng: profile.latlng?.longitude ?? null,
	};
};

export const createOnboardingService = (deps: OnboardingDeps = {}) => {
	const client = deps.client ?? gbpClient;
	const tokens = deps.tokens ?? tokenStore;
	const discovery = deps.discovery ?? discoveryService;
	const binding = deps.binding ?? bindingService;
	const enqueue = deps.enqueue ?? ((location: ILocation, userId: UserId) => enqueueRankRun(location, userId, 'manual'));
	const now = deps.now ?? (() => new Date());

	const getState = async (userId: UserId): Promise<OnboardingState> => {
		let gbp: OnboardingState['gbp'] = { connected: false, google_email: null, status: 'none' };
		try {
			const stored = await tokens.load(userId, tokenTypes.GBP);
			if (stored) gbp = { connected: stored.status === 'active', google_email: stored.googleEmail, status: stored.status };
		} catch {
			gbp = { connected: false, google_email: null, status: 'unreadable' };
		}
		const locations = await Location.find({ created_by: userId, is_active: true, onboarding: { $exists: true } })
			.select({ name: 1, onboarding: 1 })
			.lean<ILocation[]>();
		const rows = locations
			.map((l) => ({ location_id: String(l._id), name: l.name, onboarding: l.onboarding }))
			.sort((a, b) => Number(a.onboarding?.step === 'completed') - Number(b.onboarding?.step === 'completed'));
		return { gbp, locations: rows };
	};

	/** Every profile the connected account can access, with whether we can onboard it. */
	const listProfiles = async (userId: UserId) => {
		const result = await discovery.listAllLocations(userId);
		return {
			...result,
			locations: result.locations.map((l: DiscoveredLocation) => ({
				...l,
				supported: l.region_code !== null && SUPPORTED_REGIONS.includes(l.region_code),
			})),
		};
	};

	const ownedLocation = async (userId: UserId, locationId: string) => {
		if (!Types.ObjectId.isValid(locationId)) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid location_id');
		const location = await Location.findOne({ _id: locationId, created_by: userId, is_active: true });
		if (!location) throw new ApiError(httpStatus.NOT_FOUND, 'Location not found');
		return location;
	};

	const selectProfile = async (userId: UserId, input: SelectProfileInput): Promise<SelectProfileResult> => {
		let profile: GbpLocation;
		try {
			profile = await client.getLocation(userId, input.gbpLocationId);
		} catch (err) {
			throw toGbpApiError(err, { forbiddenMessage: 'The connected Google account cannot access this Business Profile location.' });
		}
		const region = regionOf(profile);
		if (!region || !SUPPORTED_REGIONS.includes(region)) {
			throw new ApiError(httpStatus.BAD_REQUEST, 'Only US and Canadian businesses are supported.');
		}

		let location: ILocation | null = null;
		let created = false;
		if (input.location_id) {
			location = await ownedLocation(userId, input.location_id);
		} else if (profile.placeId) {
			location = await Location.findOne({ created_by: userId, is_active: true, place_id: profile.placeId });
		}
		if (!location) {
			location = await Location.create({ ...locationFieldsFromProfile(profile), created_by: userId });
			created = true;
			await Profile.updateOne({ user_id: userId, is_active: true }, { $inc: { no_of_locations: 1 } });
		}

		const bound = await binding.bindLocation(userId, {
			location_id: String(location._id),
			gbpAccountId: input.gbpAccountId,
			gbpLocationId: input.gbpLocationId,
			profile,
		});
		if (!location.onboarding || location.onboarding.step !== 'completed') {
			await Location.updateOne(
				{ _id: location._id },
				{ $set: { onboarding: { step: 'profile_selected', started_at: location.onboarding?.started_at ?? now(), completed_at: null } } },
			);
		}
		const saved = (await Location.findById(location._id).lean<ILocation>()) as ILocation;
		logger.info(`onboarding: profile selected for location ${String(saved._id)} (created=${created})`);
		return {
			location: {
				location_id: String(saved._id),
				name: saved.name,
				address: saved.address,
				place_id: saved.place_id ?? null,
				lat: typeof saved.lat === 'number' ? saved.lat : null,
				lng: typeof saved.lng === 'number' ? saved.lng : null,
			},
			created,
			binding: bound,
		};
	};

	const complete = async (userId: UserId, locationId: string): Promise<CompleteResult> => {
		const location = await ownedLocation(userId, locationId);
		if (location.onboarding?.step === 'completed' && location.onboarding.completed_at) {
			const last = await RankRun.findOne({ location_id: location._id }).sort({ run_at: -1 }).lean();
			return {
				completed: true,
				completed_at: location.onboarding.completed_at,
				rank_run: last ? { run_id: String(last._id), status: last.status, existing: true } : null,
				gbp_sync: { requested_at: location.gbp_sync?.requested_at ?? null },
			};
		}
		if (!(await UserGBP.exists({ user_id: userId, location_id: location._id, is_active: true }))) {
			throw new ApiError(httpStatus.BAD_REQUEST, 'Select a Business Profile for this location first.');
		}
		if (withDefaults(location.tracking).keywords.length === 0) {
			throw new ApiError(httpStatus.BAD_REQUEST, 'Add at least one keyword first.');
		}

		let run: EnqueueResult;
		try {
			run = await enqueue(location, userId);
		} catch (err) {
			if (err instanceof RunOverCapError) throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, err.message);
			throw err;
		}
		const at = now();
		await Location.updateOne(
			{ _id: location._id },
			{
				$set: {
					onboarding: { step: 'completed', started_at: location.onboarding?.started_at ?? at, completed_at: at },
					'gbp_sync.requested_at': at,
				},
			},
		);
		logger.info(`onboarding: location ${String(location._id)} completed (rank run ${run.run_id}, gbp sync requested)`);
		return {
			completed: true,
			completed_at: at,
			rank_run: { run_id: run.run_id, status: run.status, existing: run.existing },
			gbp_sync: { requested_at: at },
		};
	};

	return { getState, listProfiles, selectProfile, complete };
};

export const onboardingService = createOnboardingService();
