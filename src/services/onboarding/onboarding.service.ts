import { Types } from 'mongoose';
import httpStatus from 'http-status';
import logger from '../../configs/logger';
import { tokenTypes } from '../../configs/constantTypes';
import { ConnectionRef, GbpClient, gbpClient } from '../../clients/gbpClient';
import { GbpLocation } from '../../clients/types/gbp';
import { Client, GbpSync, ILocation, Location, RankRun, UserGBP } from '../../models';
import { ApiError, apiErrorWithData } from '../../utils';
import { OrgContext } from '../org/context';
import { canWrite, findAccessibleLocation, findLocationForUser, locationScope, readOnly } from '../org/access';
import { assertCanAddLocation } from '../org/limits';
import { EmptyStates, OrgOnboarding, orgOnboardingState } from '../org/onboardingState';
import { BindResult, bindingService } from '../gbp/binding.service';
import { countryName, formatAddress } from '../gbp/discovery.service';
import { toGbpApiError } from '../gbp/errors';
import { resolveConnection } from '../gbp/connections';
import { TokenStore, tokenStore } from '../gbp/tokenStore';
import { EnqueueResult, RunOverCapError, enqueueRankRun } from '../ranking/rankRun.service';
import { SyncEnqueueResult, enqueueGbpSync } from '../gbp/sync.service';
import { initialSchedule } from '../refresh/cadence';
import { withDefaults } from '../ranking/trackingSettings';
import { suggestForLocation } from '../citations/suggest';

// Onboarding (Phase 7a, organizations since Phase 8): connect Google → pick a Business Profile (creates
// or links a Location of the organization and binds it) → keywords → competitors → complete (first rank
// run, plus the first GBP sync when bound). Locations can also come from a Places search (POST /locations).

export const SUPPORTED_REGIONS = ['US', 'CA'];
const NOT_AVAILABLE = 'n/a';

type UserId = Types.ObjectId | string;

export interface OnboardingState {
	/** Phase 8: the organization's onboarding steps (derived; resumable). */
	organization: OrgOnboarding;
	empty_states: EmptyStates;
	gbp: {
		connected: boolean;
		/** Every connected Google account ("Connected as …"); a user may connect several. */
		connections: { google_sub: string | null; google_email: string | null; status: 'active' | 'revoked' }[];
	};
	locations: { location_id: string; name: string; source: ILocation['source'] | null; client_id: string | null; onboarding: ILocation['onboarding'] }[];
}

export interface SelectProfileInput {
	gbpAccountId: string;
	gbpLocationId: string;
	location_id?: string;
	/** Which connected Google account the profile was listed under; required with several. */
	google_sub?: string;
	/** Phase 8 (agency): assign the new or linked location to this client of the organization. */
	client_id?: string;
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
	const binding = deps.binding ?? bindingService;
	const enqueue = deps.enqueue ?? ((location: ILocation, userId: UserId) => enqueueRankRun(location, userId, 'manual'));
	const enqueueSync = deps.enqueueSync ?? ((location: ILocation, userId: UserId) => enqueueGbpSync(location, userId, 'onboarding'));
	const now = deps.now ?? (() => new Date());

	const getState = async (ctx: OrgContext): Promise<OnboardingState> => {
		const connections = (await tokens.listConnections(ctx.userId, tokenTypes.GBP)).map((c) => ({
			google_sub: c.googleSub,
			google_email: c.googleEmail,
			status: c.status,
		}));
		const gbp: OnboardingState['gbp'] = { connected: connections.some((c) => c.status === 'active'), connections };
		const { organization, empty_states } = await orgOnboardingState(ctx, { tokens, now: now() });
		const locations = await Location.find(locationScope(ctx))
			.select({ name: 1, onboarding: 1, source: 1, client_id: 1 })
			.lean<ILocation[]>();
		const rows = locations
			.map((l) => ({
				location_id: String(l._id),
				name: l.name,
				source: l.source ?? null,
				client_id: l.client_id ? String(l.client_id) : null,
				onboarding: l.onboarding,
			}))
			.sort((a, b) => Number(a.onboarding?.step === 'completed' || !a.onboarding) - Number(b.onboarding?.step === 'completed' || !b.onboarding));
		return { organization, empty_states, gbp, locations: rows };
	};

	/** A location of the context's organization the caller may change (404 otherwise; 403 for a client_user). */
	const writableLocation = async (ctx: OrgContext, locationId: string) => {
		if (!Types.ObjectId.isValid(locationId)) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid location_id');
		if (!canWrite(ctx)) throw readOnly();
		const location = await findAccessibleLocation(ctx, locationId);
		if (!location) throw new ApiError(httpStatus.NOT_FOUND, 'Location not found');
		return location;
	};

	/** Phase 8 (agency): the client must belong to the organization. */
	const clientOf = async (ctx: OrgContext, clientId: string | undefined) => {
		if (!clientId) return null;
		if (ctx.organization.type !== 'agency') throw apiErrorWithData(httpStatus.FORBIDDEN, 'Clients are available to agency organizations only.', { reason: 'agency_only' });
		if (!Types.ObjectId.isValid(clientId)) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid client_id');
		const client = await Client.findOne({ _id: clientId, organization_id: ctx.organization._id, is_active: true }).select({ _id: 1 }).lean();
		if (!client) throw new ApiError(httpStatus.NOT_FOUND, 'Client not found');
		return client._id as Types.ObjectId;
	};

	const selectProfile = async (ctx: OrgContext, input: SelectProfileInput): Promise<SelectProfileResult> => {
		if (!canWrite(ctx)) throw readOnly();
		const userId = ctx.userId;
		const clientId = await clientOf(ctx, input.client_id);
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
			location = await writableLocation(ctx, input.location_id);
		} else if (profile.placeId) {
			// The same place already in the organization is linked (e.g. added from a Places search, GBP bound later).
			location = await Location.findOne({ organization_id: ctx.organization._id, is_active: true, place_id: profile.placeId });
		}
		if (!location) {
			await assertCanAddLocation(ctx.organization);
			const fields = locationFieldsFromProfile(profile);
			location = await Location.create({
				...fields,
				center_source: fields.lat !== null ? 'gbp' : null,
				organization_id: ctx.organization._id,
				source: 'gbp',
				client_id: clientId,
				created_by: userId,
			});
			created = true;
		} else if (clientId) {
			await Location.updateOne({ _id: location._id }, { $set: { client_id: clientId } });
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
		// Start (or restart at the first step) only before keywords: linking GBP to a location further along
		// (e.g. added from a Places search) never moves its onboarding backwards.
		const early = ['profile_selected', 'place_selected', 'center_needed'];
		if (!location.onboarding || early.includes(location.onboarding.step)) {
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
		const access = await findLocationForUser(userId, locationId, { write: true });
		if (!access) throw new ApiError(httpStatus.NOT_FOUND, 'Location not found');
		const location = access.location;
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
		if (typeof location.lat !== 'number' || typeof location.lng !== 'number') {
			throw apiErrorWithData(httpStatus.BAD_REQUEST, 'Set the business center first (city or ZIP).', { reason: 'center_required' });
		}
		if (withDefaults(location.tracking).keywords.length === 0) {
			throw apiErrorWithData(httpStatus.BAD_REQUEST, 'Add at least one keyword first.', { reason: 'keywords_required' });
		}

		let run: EnqueueResult;
		try {
			run = await enqueue(location, userId);
		} catch (err) {
			if (err instanceof RunOverCapError) throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, err.message);
			throw err;
		}
		// First GBP sync now when bound (Phase 8: a Places-search location completes without GBP);
		// a failure here doesn't block completion.
		let gbpSync: CompleteResult['gbp_sync'] = null;
		if (await UserGBP.exists({ location_id: location._id, is_active: true })) {
			try {
				const sync = await enqueueSync(location, userId);
				gbpSync = { sync_id: sync.sync_id, status: sync.status, existing: sync.existing };
			} catch (err) {
				gbpSync = { error: err instanceof Error ? err.message : 'GBP sync could not be queued' };
			}
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
		// Phase 16: the location's first citation list (directories matching its category and country).
		// A failure never blocks completion; admins can run the suggestion again.
		try {
			const suggested = await suggestForLocation(location._id);
			logger.info(`onboarding: location ${String(location._id)} citation suggestions added=${suggested.added.length} category_matched=${suggested.category_matched}`);
		} catch (err) {
			logger.warn(`onboarding: citation suggestions failed for location ${String(location._id)}: ${(err as Error).message}`);
		}
		return {
			completed: true,
			completed_at: at,
			rank_run: { run_id: run.run_id, status: run.status, existing: run.existing },
			gbp_sync: gbpSync,
			refresh: schedule,
		};
	};

	// selectProfile is the internal create-or-link + bind step of POST /gbp/picks/:pickId/bind (2026-10-01).
	return { getState, selectProfile, complete };
};

export const onboardingService = createOnboardingService();
