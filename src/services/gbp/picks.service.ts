import { Types } from 'mongoose';
import httpStatus from 'http-status';
import logger from '../../configs/logger';
import { tokenTypes } from '../../configs/constantTypes';
import { GbpPick, IGbpPick, Location, UserGBP } from '../../models';
import { ApiError, apiErrorWithData } from '../../utils';
import { OrgContext } from '../org/context';
import { canWrite, readOnly } from '../org/access';
import { SUPPORTED_REGIONS, SelectProfileResult, onboardingService } from '../onboarding/onboarding.service';
import { DiscoveredLocation, discoveryService } from './discovery.service';
import { TokenStore, tokenStore } from './tokenStore';
import { MAX_GOOGLE_ACCOUNTS } from './constants';

// Google connect, pick, then bind (Mohit, 2026-10-01), per user:
// 1. Connect a Google account (up to MAX_GOOGLE_ACCOUNTS per user; oauth.service).
// 2. In the connect modal: list that account's Business Profile locations and save the ones the user picks.
//    Picking is free and creates no Location; only picked locations show on the locations page.
// 3. Bind (the Bind button on the locations table, behind the subscription gate): creates or links our
//    Location, binds the profile and counts toward the subscription like any added location.
// Disconnecting an account unbinds its locations and deletes its picks (binding.service).

export { MAX_GOOGLE_ACCOUNTS };

type UserId = Types.ObjectId | string;

export interface PicksDeps {
	tokens?: Pick<TokenStore, 'listConnections'>;
	listLocations?: (userId: UserId, googleSub: string) => Promise<{ accounts: number; locations: DiscoveredLocation[]; errors: { account: string; message: string }[] }>;
	bindProfile?: (ctx: OrgContext, input: { gbpAccountId: string; gbpLocationId: string; google_sub: string; client_id?: string }) => Promise<SelectProfileResult>;
	now?: () => Date;
}

export interface PendingPickRow {
	pick_id: string;
	google_sub: string;
	google_email: string | null;
	gbpLocationId: string;
	title: string | null;
	address: string | null;
	city: string | null;
	region_code: string | null;
	place_id: string | null;
	picked_at: Date;
	/** The organization already has a location for this place: binding links to it (no new location slot). */
	existing_location_id: string | null;
}

const isSupported = (regionCode: string | null): boolean => regionCode !== null && SUPPORTED_REGIONS.includes(regionCode);

const pickNotFound = () => new ApiError(httpStatus.NOT_FOUND, 'Pick not found');

export const createPicksService = (deps: PicksDeps = {}) => {
	const tokens = deps.tokens ?? tokenStore;
	const listLocations = deps.listLocations ?? discoveryService.listConnectionLocations;
	const bindProfile = deps.bindProfile ?? ((ctx, input) => onboardingService.selectProfile(ctx, input));
	const now = deps.now ?? (() => new Date());

	/** The user's connection for googleSub (404 when it isn't one of theirs). */
	const connectionOf = async (userId: UserId, googleSub: string) => {
		const connection = (await tokens.listConnections(userId, tokenTypes.GBP)).find((c) => c.googleSub === googleSub);
		if (!connection) throw apiErrorWithData(httpStatus.NOT_FOUND, 'That Google account is not connected.', { reason: 'google_account_not_connected' });
		return connection;
	};

	/** Connected Google accounts (max MAX_GOOGLE_ACCOUNTS), with how many of their locations are picked and bound. */
	const connections = async (ctx: OrgContext) => {
		const list = await tokens.listConnections(ctx.userId, tokenTypes.GBP);
		const picks = await GbpPick.find({ organization_id: ctx.organization._id, user_id: ctx.userId }).select({ google_sub: 1, location_id: 1 }).lean<IGbpPick[]>();
		// 2026-10-01: the locations bound through each account, so the disconnect dialog can name them (they are
		// deleted on disconnect). Every bound location of this user, in any organization.
		const bindings = await UserGBP.find({ user_id: ctx.userId, is_active: true }).select({ location_id: 1, google_sub: 1 }).lean();
		const named = bindings.length
			? await Location.find({ _id: { $in: bindings.map((b) => b.location_id) }, is_active: true }).select({ name: 1 }).lean()
			: [];
		const nameOf = new Map(named.map((l) => [String(l._id), l.name]));
		return {
			limit: MAX_GOOGLE_ACCOUNTS,
			connections: list.map((c) => {
				const own = picks.filter((p) => p.google_sub === c.googleSub);
				return {
					google_sub: c.googleSub,
					google_email: c.googleEmail,
					/** 'revoked': Google refused the stored access; connect the same account again. */
					status: c.status,
					picked: own.filter((p) => !p.location_id).length,
					bound: own.filter((p) => p.location_id).length,
					locations: bindings
						.filter((b) => b.google_sub === c.googleSub && nameOf.has(String(b.location_id)))
						.map((b) => ({ location_id: String(b.location_id), name: nameOf.get(String(b.location_id)) as string })),
				};
			}),
		};
	};

	/** One account's Business Profile locations for the connect modal, with picked / bound flags. */
	const accountLocations = async (ctx: OrgContext, googleSub: string) => {
		const connection = await connectionOf(ctx.userId, googleSub);
		const listed = await listLocations(ctx.userId, googleSub);
		const picks = await GbpPick.find({ organization_id: ctx.organization._id, gbpLocationId: { $in: listed.locations.map((l) => l.gbpLocationId) } }).lean<IGbpPick[]>();
		const pickOf = new Map(picks.map((p) => [p.gbpLocationId, p]));
		return {
			google_sub: googleSub,
			google_email: connection.googleEmail,
			locations: listed.locations.map((l) => {
				const pick = pickOf.get(l.gbpLocationId);
				return {
					gbpAccountId: l.gbpAccountId,
					gbpLocationId: l.gbpLocationId,
					title: l.title,
					address: l.address,
					city: l.city,
					region_code: l.region_code,
					place_id: l.place_id,
					/** Only US and Canadian businesses can be picked. */
					supported: isSupported(l.region_code),
					picked: Boolean(pick && String(pick.user_id) === String(ctx.userId)),
					/** Picked by another user of the organization (it can't be picked twice). */
					picked_by_other: Boolean(pick && String(pick.user_id) !== String(ctx.userId)),
					pick_id: pick && String(pick.user_id) === String(ctx.userId) ? String(pick._id) : null,
					bound_location_id: pick?.location_id ? String(pick.location_id) : l.bound_location_id,
				};
			}),
			errors: listed.errors,
		};
	};

	/**
	 * Saves the modal's selection for one account: the listed ids become this account's picks. Unbound picks
	 * left out are removed; bound ones stay (unbind them first). 400 for an id the account doesn't list or a
	 * non-US/CA profile; 409 for a profile another user of the organization picked.
	 */
	const savePicks = async (ctx: OrgContext, googleSub: string, gbpLocationIds: string[]) => {
		if (!canWrite(ctx)) throw readOnly();
		await connectionOf(ctx.userId, googleSub);
		const wanted = [...new Set(gbpLocationIds)];
		const listed = await listLocations(ctx.userId, googleSub);
		const byId = new Map(listed.locations.map((l) => [l.gbpLocationId, l]));
		const unknown = wanted.filter((id) => !byId.has(id));
		if (unknown.length) throw apiErrorWithData(httpStatus.BAD_REQUEST, 'This Google account has no access to some of the selected locations.', { reason: 'unknown_location', gbp_location_ids: unknown });
		const unsupported = wanted.filter((id) => !isSupported(byId.get(id)?.region_code ?? null));
		if (unsupported.length) throw apiErrorWithData(httpStatus.BAD_REQUEST, 'Only US and Canadian businesses are supported.', { reason: 'unsupported_region', gbp_location_ids: unsupported });
		const others = await GbpPick.find({ organization_id: ctx.organization._id, gbpLocationId: { $in: wanted }, user_id: { $ne: ctx.userId } }).select({ gbpLocationId: 1 }).lean<IGbpPick[]>();
		if (others.length) throw apiErrorWithData(httpStatus.CONFLICT, 'Another user of your organization already picked some of these locations.', { reason: 'picked_by_other', gbp_location_ids: others.map((o) => o.gbpLocationId) });

		const at = now();
		for (const id of wanted) {
			const l = byId.get(id) as DiscoveredLocation;
			await GbpPick.updateOne(
				{ organization_id: ctx.organization._id, gbpLocationId: id },
				{
					$set: { google_sub: googleSub, gbpAccountId: l.gbpAccountId, title: l.title, address: l.address, city: l.city, region_code: l.region_code, place_id: l.place_id },
					$setOnInsert: { organization_id: ctx.organization._id, user_id: ctx.userId, gbpLocationId: id, picked_at: at, location_id: null, bound_at: null },
				},
				{ upsert: true },
			);
		}
		const removed = await GbpPick.deleteMany({ organization_id: ctx.organization._id, user_id: ctx.userId, google_sub: googleSub, location_id: null, gbpLocationId: { $nin: wanted } });
		const keptBound = await GbpPick.countDocuments({ organization_id: ctx.organization._id, user_id: ctx.userId, google_sub: googleSub, location_id: { $ne: null }, gbpLocationId: { $nin: wanted } });
		logger.info(`gbp picks: user ${String(ctx.userId)} picked ${wanted.length} (removed ${removed.deletedCount})`);
		return { ...(await accountLocations(ctx, googleSub)), picked: wanted.length, removed: removed.deletedCount, kept_bound: keptBound };
	};

	/** The user's picks that are not bound yet (the locations page shows them with a Bind button). */
	const pending = async (ctx: OrgContext): Promise<PendingPickRow[]> => {
		const picks = await GbpPick.find({ organization_id: ctx.organization._id, user_id: ctx.userId, location_id: null }).sort({ picked_at: 1 }).lean<IGbpPick[]>();
		if (!picks.length) return [];
		const emails = new Map((await tokens.listConnections(ctx.userId, tokenTypes.GBP)).map((c) => [c.googleSub, c.googleEmail]));
		const placeIds = picks.map((p) => p.place_id).filter((id): id is string => Boolean(id));
		const existing = placeIds.length
			? await Location.find({ organization_id: ctx.organization._id, is_active: true, place_id: { $in: placeIds } }).select({ place_id: 1 }).lean()
			: [];
		const locationOf = new Map(existing.map((l) => [l.place_id as string, String(l._id)]));
		return picks.map((p) => ({
			pick_id: String(p._id),
			google_sub: p.google_sub,
			google_email: emails.get(p.google_sub) ?? null,
			gbpLocationId: p.gbpLocationId,
			title: p.title,
			address: p.address,
			city: p.city,
			region_code: p.region_code,
			place_id: p.place_id,
			picked_at: p.picked_at,
			existing_location_id: p.place_id ? (locationOf.get(p.place_id) ?? null) : null,
		}));
	};

	const ownPick = async (ctx: OrgContext, pickId: string) => {
		if (!Types.ObjectId.isValid(pickId)) throw pickNotFound();
		const pick = await GbpPick.findOne({ _id: pickId, organization_id: ctx.organization._id, user_id: ctx.userId });
		if (!pick) throw pickNotFound();
		return pick;
	};

	/**
	 * The Bind button: creates the Location from the profile (or links the organization's location for the same
	 * place), binds it and marks the pick bound. Creating a location goes through the subscription limits
	 * (402 subscription_required / location_payment_required with a quote, 403 enterprise_required).
	 */
	const bind = async (ctx: OrgContext, pickId: string, input: { client_id?: string }) => {
		if (!canWrite(ctx)) throw readOnly();
		const pick = await ownPick(ctx, pickId);
		if (pick.location_id) throw apiErrorWithData(httpStatus.CONFLICT, 'This location is already bound.', { reason: 'already_bound', location_id: String(pick.location_id) });
		const result = await bindProfile(ctx, { gbpAccountId: pick.gbpAccountId, gbpLocationId: pick.gbpLocationId, google_sub: pick.google_sub, client_id: input.client_id });
		await GbpPick.updateOne({ _id: pick._id }, { $set: { location_id: new Types.ObjectId(result.location.location_id), bound_at: now() } });
		return { pick_id: String(pick._id), ...result };
	};

	/** Removes an unbound pick from the locations page (409 for a bound one: unbind the location instead). */
	const removePick = async (ctx: OrgContext, pickId: string) => {
		if (!canWrite(ctx)) throw readOnly();
		const pick = await ownPick(ctx, pickId);
		if (pick.location_id) throw apiErrorWithData(httpStatus.CONFLICT, 'This location is bound: unbind it instead.', { reason: 'already_bound', location_id: String(pick.location_id) });
		await GbpPick.deleteOne({ _id: pick._id });
		return { removed: true, pick_id: pickId };
	};

	return { connections, accountLocations, savePicks, pending, bind, removePick };
};

export const picksService = createPicksService();

