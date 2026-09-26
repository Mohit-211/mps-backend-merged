import { Agenda } from 'agenda';
import { Types } from 'mongoose';
import httpStatus from 'http-status';
import logger from '../../configs/logger';
import { getAgenda } from '../../configs/agenda';
import { postPublishStatus, tokenTypes } from '../../configs/constantTypes';
import { ConnectionRef, GbpClient, gbpClient } from '../../clients/gbpClient';
import { GbpLocation } from '../../clients/types/gbp';
import { JOB_NAMES } from '../../jobs/jobNames';
import { GBPPost, Location, UserGBP } from '../../models';
import { ApiError } from '../../utils';
import { toGbpApiError } from './errors';
import { TokenStore, tokenStore } from './tokenStore';
import { resolveConnection } from './connections';

// Binding a GBP location to one of our Locations, unbinding it (AUDIT C12), and disconnecting GBP.
// - Bind reads the profile from Google (never trusts client-sent title/metadata) and takes place_id
//   from metadata.placeId. Location.place_id is set only when empty; a different value is reported
//   as a conflict and never overwritten. lat/lng are filled from GBP only when both are empty.
// - Unbind removes the binding, cancels the location's gbp-sync jobs and pending scheduled posts, and
//   deletes the GBP tokens when it was the user's last binding (tokens belong to the Google account).
// - Disconnect revokes at Google (best effort), unbinds everything and deletes the tokens.

const ACCOUNT_ID = /^accounts\/[A-Za-z0-9_-]{1,64}$/;
const LOCATION_ID = /^locations\/[A-Za-z0-9_-]{1,64}$/;
export const UNBOUND_REASON = 'GBP location unbound';

type UserId = Types.ObjectId | string;

export interface BindInput {
	location_id: string;
	gbpAccountId: string;
	gbpLocationId: string;
	/** Which connected Google account to bind through; required when the user has several. */
	google_sub?: string | null;
	/** Internal: a profile already fetched from Google for gbpLocationId (onboarding), to avoid a second call. */
	profile?: GbpLocation;
}

export type PlaceIdStatus = 'set' | 'match' | 'conflict' | 'none';

export interface BindResult {
	binding: {
		location_id: string;
		gbpAccountId: string;
		gbpLocationId: string;
		title: string | null;
		place_id: string | null;
	};
	place_id: { location: string | null; gbp: string | null; status: PlaceIdStatus };
	coordinates: 'set' | 'kept' | 'none';
}

export interface UnbindResult {
	unbound: true;
	jobs_cancelled: { gbp_sync: number; scheduled_posts: number };
	tokens_deleted: boolean;
}

export interface BindingDeps {
	client?: Pick<GbpClient, 'getLocation' | 'revoke'>;
	tokens?: Pick<TokenStore, 'load' | 'remove' | 'listConnections'>;
	agenda?: Agenda;
}

export const createBindingService = (deps: BindingDeps = {}) => {
	const client = deps.client ?? gbpClient;
	const tokens = deps.tokens ?? tokenStore;
	const agenda = (): Agenda => deps.agenda ?? getAgenda();

	const ownedLocation = async (userId: UserId, locationId: string) => {
		if (!Types.ObjectId.isValid(locationId)) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid location_id');
		const location = await Location.findOne({ _id: locationId, created_by: userId, is_active: true });
		if (!location) throw new ApiError(httpStatus.NOT_FOUND, 'Location not found');
		return location;
	};

	const bindLocation = async (userId: UserId, input: BindInput): Promise<BindResult> => {
		if (!ACCOUNT_ID.test(input.gbpAccountId ?? '')) throw new ApiError(httpStatus.BAD_REQUEST, 'gbpAccountId must look like accounts/123');
		if (!LOCATION_ID.test(input.gbpLocationId ?? '')) throw new ApiError(httpStatus.BAD_REQUEST, 'gbpLocationId must look like locations/456');
		const location = await ownedLocation(userId, input.location_id);

		const elsewhere = await UserGBP.findOne({
			user_id: userId,
			gbpLocationId: input.gbpLocationId,
			is_active: true,
			location_id: { $ne: location._id },
		});
		if (elsewhere) {
			throw new ApiError(
				httpStatus.CONFLICT,
				`This Google Business Profile is already bound to location ${String(elsewhere.location_id)}. Unbind it first.`,
			);
		}

		let conn: ConnectionRef;
		try {
			conn = await resolveConnection(userId, input.google_sub, tokens);
		} catch (err) {
			throw toGbpApiError(err);
		}
		let gbp: GbpLocation;
		if (input.profile && input.profile.name === input.gbpLocationId) {
			gbp = input.profile;
		} else {
			try {
				gbp = await client.getLocation(conn, input.gbpLocationId);
			} catch (err) {
				throw toGbpApiError(err, { forbiddenMessage: 'The connected Google account cannot access this Business Profile location.' });
			}
		}

		await UserGBP.deleteMany({ location_id: location._id });
		await UserGBP.create({
			user_id: userId,
			location_id: location._id,
			gbpAccountId: input.gbpAccountId,
			gbpLocationId: gbp.name,
			place_id: gbp.placeId,
			google_sub: conn.googleSub ?? null,
			title: gbp.title,
			websiteUri: gbp.websiteUri,
			languageCode: gbp.languageCode,
			metadata: gbp.metadata,
			profile: gbp.profile,
			bound_at: new Date(),
			is_active: true,
		});

		// place_id: set only when empty (atomic), never overwrite a different value.
		const current = location.place_id ? String(location.place_id) : null;
		let status: PlaceIdStatus = 'none';
		if (gbp.placeId && !current) {
			const set = await Location.updateOne(
				{ _id: location._id, $or: [{ place_id: null }, { place_id: '' }] },
				{ $set: { place_id: gbp.placeId } },
			);
			status = set.modifiedCount === 1 ? 'set' : 'conflict';
		} else if (gbp.placeId && current) {
			status = current === gbp.placeId ? 'match' : 'conflict';
		}
		if (status === 'conflict') {
			logger.warn(`gbp bind: place_id conflict on location ${String(location._id)} (kept the existing value)`);
		}

		let coordinates: BindResult['coordinates'] = 'none';
		if (gbp.latlng) {
			const hasCoordinates = typeof location.lat === 'number' && typeof location.lng === 'number';
			if (hasCoordinates) coordinates = 'kept';
			else {
				await Location.updateOne(
					{ _id: location._id, lat: null, lng: null },
					{ $set: { lat: gbp.latlng.latitude, lng: gbp.latlng.longitude, center_source: 'gbp' } },
				);
				coordinates = 'set';
			}
		}

		return {
			binding: {
				location_id: String(location._id),
				gbpAccountId: input.gbpAccountId,
				gbpLocationId: gbp.name,
				title: gbp.title,
				place_id: gbp.placeId,
			},
			place_id: { location: status === 'set' ? gbp.placeId : current, gbp: gbp.placeId, status },
			coordinates,
		};
	};

	/** Cancels the location's gbp-sync jobs and pending scheduled posts for the GBP location. */
	const cancelLocationJobs = async (
		userId: UserId,
		locationId: Types.ObjectId,
		gbpLocationId: string,
	): Promise<UnbindResult['jobs_cancelled']> => {
		const ids = [String(locationId), locationId];
		const gbpSync = (await agenda().cancel({ name: JOB_NAMES.GBP_SYNC, 'data.location_id': { $in: ids } })) ?? 0;

		const posts = await GBPPost.find({
			created_by: userId,
			gbpLocationId,
			status: postPublishStatus.scheduled,
			is_active: true,
		}).select({ _id: 1 });
		const postIds = posts.flatMap((p) => [p._id, String(p._id)]);
		if (posts.length > 0) {
			await agenda().cancel({ name: JOB_NAMES.POST_TO_GBP, 'data.gbpPostObj.gbpPostID': { $in: postIds } });
			await GBPPost.updateMany(
				{ _id: { $in: posts.map((p) => p._id) } },
				{ $set: { status: postPublishStatus.rejected, is_scheduled: false, last_error: UNBOUND_REASON } },
			);
		}
		return { gbp_sync: gbpSync, scheduled_posts: posts.length };
	};

	/**
	 * Bindings made through a connection. Pre-7a bindings (google_sub null) belong to the user's only
	 * connection, so they are included when there is just one.
	 */
	const bindingsOf = async (userId: UserId, googleSub: string | null) => {
		const connections = await tokens.listConnections(userId, tokenTypes.GBP);
		const subs: (string | null)[] = connections.length <= 1 ? [googleSub, null] : [googleSub];
		return UserGBP.find({ user_id: userId, is_active: true, google_sub: { $in: [...new Set(subs)] } });
	};

	/** Deletes a connection's tokens once none of its profiles is bound any more. */
	const deleteTokensIfUnbound = async (userId: UserId, googleSub: string | null): Promise<boolean> => {
		if ((await bindingsOf(userId, googleSub)).length > 0) return false;
		return tokens.remove(userId, tokenTypes.GBP, googleSub);
	};

	const unbindLocation = async (userId: UserId, locationId: string): Promise<UnbindResult> => {
		const location = await ownedLocation(userId, locationId);
		const binding = await UserGBP.findOne({ user_id: userId, location_id: location._id, is_active: true });
		if (!binding) throw new ApiError(httpStatus.NOT_FOUND, 'This location is not bound to a Google Business Profile');

		let googleSub = binding.google_sub ?? null;
		if (googleSub === null) {
			// Pre-7a binding: it belongs to the only connection, if there is exactly one.
			const connections = await tokens.listConnections(userId, tokenTypes.GBP);
			if (connections.length === 1) googleSub = connections[0].googleSub;
		}
		const jobs = await cancelLocationJobs(userId, location._id as Types.ObjectId, binding.gbpLocationId);
		await UserGBP.deleteOne({ _id: binding._id });
		const tokensDeleted = await deleteTokensIfUnbound(userId, googleSub);
		logger.info(`gbp unbind: location ${String(location._id)} (tokens_deleted=${tokensDeleted})`);
		return { unbound: true, jobs_cancelled: jobs, tokens_deleted: tokensDeleted };
	};

	/**
	 * Disconnect one Google account: revoke it at Google (best effort), unbind only its profiles
	 * (cancelling their jobs) and delete that connection. Other connections are untouched.
	 */
	const disconnect = async (
		userId: UserId,
		googleSub?: string | null,
	): Promise<{ revoked: boolean; bindings_removed: number; google_email: string | null }> => {
		let conn: ConnectionRef;
		try {
			conn = await resolveConnection(userId, googleSub, tokens);
		} catch (err) {
			throw toGbpApiError(err);
		}
		const sub = conn.googleSub ?? null;
		let revoked = false;
		let email: string | null = null;
		try {
			const stored = await tokens.load(userId, tokenTypes.GBP, sub);
			email = stored?.googleEmail ?? null;
			if (stored) {
				await client.revoke(stored.refreshToken);
				revoked = true;
			}
		} catch (err) {
			logger.warn(`gbp disconnect: revoke at Google failed (${err instanceof Error ? err.name : 'error'}); removing local tokens anyway`);
		}
		const bindings = await bindingsOf(userId, sub);
		for (const binding of bindings) {
			await cancelLocationJobs(userId, binding.location_id as unknown as Types.ObjectId, binding.gbpLocationId);
			await UserGBP.deleteOne({ _id: binding._id });
		}
		await tokens.remove(userId, tokenTypes.GBP, sub);
		return { revoked, bindings_removed: bindings.length, google_email: email };
	};

	return { bindLocation, unbindLocation, disconnect };
};

export const bindingService = createBindingService();
