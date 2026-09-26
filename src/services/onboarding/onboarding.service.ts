import { Types } from 'mongoose';
import httpStatus from 'http-status';
import logger from '../../configs/logger';
import { tokenTypes } from '../../configs/constantTypes';
import { ConnectionRef, GbpClient, gbpClient } from '../../clients/gbpClient';
import { GbpLocation } from '../../clients/types/gbp';
import { GbpSync, ILocation, Location, Profile, RankRun, UserGBP } from '../../models';
import { ApiError } from '../../utils';
import { BindResult, bindingService } from '../gbp/binding.service';
import { DiscoveredLocation, countryName, discoveryService, formatAddress } from '../gbp/discovery.service';
import { toGbpApiError } from '../gbp/errors';
import { resolveConnection } from '../gbp/connections';
import { TokenStore, tokenStore } from '../gbp/tokenStore';
import { EnqueueResult, RunOverCapError, enqueueRankRun } from '../ranking/rankRun.service';
import { SyncEnqueueResult, enqueueGbpSync } from '../gbp/sync.service';
import { initialSchedule } from '../refresh/cadence';
import { withDefaults } from '../ranking/trackingSettings';

// Onboarding (Phase 7a): connect Google → pick a Business Profile (creates or links our Location and
// binds it) → keywords → competitors → complete (first rank run + a GBP sync request for Phase 7b).

export const SUPPORTED_REGIONS = ['US', 'CA'];
const NOT_AVAILABLE = 'n/a';

type UserId = Types.ObjectId | string;

export interface OnboardingState {
	gbp: {
		connected: boolean;
		/** Every connected Google account ("Connected as …"); a user may connect several. */
		connections: { google_sub: string | null; google_email: string | null; status: 'active' | 'revoked' }[];
	};
	locations: { location_id: string; name: string; onboarding: ILocation['onboarding'] }[];
}

export interface SelectProfileInput {
	gbpAccountId: string;
	gbpLocationId: string;
	location_id?: string;
	/** Which connected Google account the profile was listed under; required with several. */
	google_sub?: string;
}

export interface SelectProfileResult {
	location: { location_id: string; name: string; address: string; place_id: string | null; lat: number | null; lng: number | null };
	created: boolean;
	/** True when the profile had no coordinates: the next step is PUT /locations/:id/center. */
	center_needed: boolean;
	binding: BindResult;
}

export interface CompleteResult {
	completed: true;
	completed_at: Date;
	rank_run: { run_id: string; status: string; existing: boolean } | null;
	/** The first GBP sync (queued now), or its error if it could not be queued. */
	gbp_sync: { sync_id: string; status: string; existing: boolean } | { error: string } | null;
	/** Monthly refresh schedule: the anchor day and the next automatic refresh. */
	refresh: { anchor_day: number; next_refresh_at: Date | null } | null;
}

export interface OnboardingDeps {
	client?: Pick<GbpClient, 'getLocation'>;
	tokens?: Pick<TokenStore, 'listConnections'>;
	discovery?: { listAllLocations: typeof discoveryService.listAllLocations };
	binding?: { bindLocation: typeof bindingService.bindLocation };
	enqueue?: (location: ILocation, userId: UserId) => Promise<EnqueueResult>;
	enqueueSync?: (location: ILocation, userId: UserId) => Promise<SyncEnqueueResult>;
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
	const enqueueSync = deps.enqueueSync ?? ((location: ILocation, userId: UserId) => enqueueGbpSync(location, userId, 'onboarding'));
	const now = deps.now ?? (() => new Date());

	const getState = async (userId: UserId): Promise<OnboardingState> => {
		const connections = (await tokens.listConnections(userId, tokenTypes.GBP)).map((c) => ({
			google_sub: c.googleSub,
			google_email: c.googleEmail,
			status: c.status,
		}));
		const gbp: OnboardingState['gbp'] = { connected: connections.some((c) => c.status === 'active'), connections };
		const locations = await Location.find({ created_by: userId, is_active: true, onboarding: { $exists: true } })
			.select({ name: 1, onboarding: 1 })
			.lean<ILocation[]>();
		const rows = locations
			.map((l) => ({ location_id: String(l._id), name: l.name, onboarding: l.onboarding }))
			.sort((a, b) => Number(a.onboarding?.step === 'completed') - Number(b.onboarding?.step === 'completed'));
		return { gbp, locations: rows };
	};

	/** Every profile from every connected Google account (grouped), with whether we can onboard it. */
	const listProfiles = async (userId: UserId) => {
		const result = await discovery.listAllLocations(userId);
		return {
			connections: result.connections.map((group) => ({
				...group,
				locations: group.locations.map((l: DiscoveredLocation) => ({
					...l,
					supported: l.region_code !== null && SUPPORTED_REGIONS.includes(l.region_code),
				})),
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
		let conn: ConnectionRef;
		try {
			conn = await resolveConnection(userId, input.google_sub, tokens);
			profile = await client.getLocation(conn, input.gbpLocationId);
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
			const fields = locationFieldsFromProfile(profile);
			location = await Location.create({ ...fields, center_source: fields.lat !== null ? 'gbp' : null, created_by: userId });
			created = true;
			await Profile.updateOne({ user_id: userId, is_active: true }, { $inc: { no_of_locations: 1 } });
		}

		const bound = await binding.bindLocation(userId, {
			location_id: String(location._id),
			gbpAccountId: input.gbpAccountId,
			gbpLocationId: input.gbpLocationId,
			google_sub: conn.googleSub,
			profile,
		});
		const afterBind = (await Location.findById(location._id).lean<ILocation>()) as ILocation;
		const centerNeeded = typeof afterBind.lat !== 'number' || typeof afterBind.lng !== 'number';
		if (!location.onboarding || location.onboarding.step !== 'completed') {
			await Location.updateOne(
				{ _id: location._id },
				{
					$set: {
						onboarding: {
							step: centerNeeded ? 'center_needed' : 'profile_selected',
							started_at: location.onboarding?.started_at ?? now(),
							completed_at: null,
						},
					},
				},
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
			center_needed: centerNeeded,
			binding: bound,
		};
	};

	const complete = async (userId: UserId, locationId: string): Promise<CompleteResult> => {
		const location = await ownedLocation(userId, locationId);
		if (location.onboarding?.step === 'completed' && location.onboarding.completed_at) {
			const last = await RankRun.findOne({ location_id: location._id }).sort({ run_at: -1 }).lean();
			const lastSync = await GbpSync.findOne({ location_id: location._id }).sort({ run_at: -1 }).lean();
			return {
				completed: true,
				completed_at: location.onboarding.completed_at,
				rank_run: last ? { run_id: String(last._id), status: last.status, existing: true } : null,
				gbp_sync: lastSync ? { sync_id: String(lastSync._id), status: lastSync.status, existing: true } : null,
				refresh: location.refresh ? { anchor_day: location.refresh.anchor_day, next_refresh_at: location.refresh.next_refresh_at } : null,
			};
		}
		if (!(await UserGBP.exists({ user_id: userId, location_id: location._id, is_active: true }))) {
			throw new ApiError(httpStatus.BAD_REQUEST, 'Select a Business Profile for this location first.');
		}
		if (typeof location.lat !== 'number' || typeof location.lng !== 'number') {
			throw new ApiError(httpStatus.BAD_REQUEST, 'Set the business center first (city or ZIP).');
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
		// First GBP sync now (the location is bound); a failure here doesn't block completion.
		let gbpSync: CompleteResult['gbp_sync'];
		try {
			const sync = await enqueueSync(location, userId);
			gbpSync = { sync_id: sync.sync_id, status: sync.status, existing: sync.existing };
		} catch (err) {
			gbpSync = { error: err instanceof Error ? err.message : 'GBP sync could not be queued' };
		}
		const at = now();
		const schedule = initialSchedule(location, at);
		await Location.updateOne(
			{ _id: location._id },
			{
				$set: {
					onboarding: { step: 'completed', started_at: location.onboarding?.started_at ?? at, completed_at: at },
					'refresh.anchor_day': schedule.anchor_day,
					'refresh.next_refresh_at': schedule.next_refresh_at,
				},
			},
		);
		logger.info(`onboarding: location ${String(location._id)} completed (rank run ${run.run_id}, next refresh ${schedule.next_refresh_at.toISOString()})`);
		return {
			completed: true,
			completed_at: at,
			rank_run: { run_id: run.run_id, status: run.status, existing: run.existing },
			gbp_sync: gbpSync,
			refresh: schedule,
		};
	};

	return { getState, listProfiles, selectProfile, complete };
};

export const onboardingService = createOnboardingService();
