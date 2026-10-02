import { Types } from 'mongoose';
import httpStatus from 'http-status';
import config from '../../configs/config';
import { GbpSync, ILocation, Location, Organization, RankRun, RefreshType, UserGBP } from '../../models';
import { ApiError, apiErrorWithData } from '../../utils';
import { loadEntitlement } from '../billing/entitlement.service';
import { refreshRef } from '../billing/refreshTokens';
import { linkSpend, refundSpend, spend } from '../billing/tokens';
import { ReportState, forceCompetitorRefresh, reportState } from '../gbp/report.service';
import { SyncEnqueueResult, enqueueGbpSync } from '../gbp/sync.service';
import { EnqueueResult, enqueueRankRun } from '../ranking/rankRun.service';
import { withDefaults } from '../ranking/trackingSettings';

// Manual refresh (Mohit, 2026-09-26): POST /locations/:id/refresh queues a rank run and/or a GBP sync,
// at most once per REFRESH_MIN_INTERVAL_HOURS per location per type. The limit is claimed with a
// compare-and-set on refresh.last_manual.<type>, so parallel clicks can't double-queue. A run/sync
// already in progress is returned instead and doesn't use up the limit.
// Phase 13a: each newly queued type spends tokens_per_refresh[type] (402 insufficient_tokens when the
// balance is short); the spend is linked to the run / sync and refunded if it fails entirely.

export const REFRESH_TYPES: RefreshType[] = ['rankings', 'gbp'];

type UserId = Types.ObjectId | string;

export type RankingsRefresh =
	| (EnqueueResult & { next_allowed_at: Date | null })
	| { skipped: 'rate_limited'; next_allowed_at: Date | null };

export type GbpRefresh =
	| (SyncEnqueueResult & { next_allowed_at: Date | null })
	| { skipped: 'gbp_not_connected' | 'rate_limited'; next_allowed_at: Date | null };

export interface RefreshResult {
	rankings?: RankingsRefresh;
	gbp?: GbpRefresh;
	/** True when every requested type was rate-limited (the API answers 429). */
	all_rate_limited: boolean;
}

export interface RefreshDeps {
	now?: Date;
	minIntervalHours?: number;
	enqueueRun?: (location: ILocation, userId: UserId) => Promise<EnqueueResult>;
	enqueueSync?: (location: ILocation, userId: UserId) => Promise<SyncEnqueueResult>;
	/** Token cost per type (default: the organization's plan). */
	costs?: Record<RefreshType, number>;
}

const lastManualPath = (type: RefreshType) => `refresh.last_manual.${type}`;

const addHours = (date: Date, hours: number): Date => new Date(date.getTime() + hours * 3600_000);

const nextAllowed = (last: Date | null | undefined, hours: number): Date | null => (last ? addHours(new Date(last), hours) : null);

/** Atomically takes the per-type slot; returns the previous value (to restore on failure) or false if limited. */
const claimSlot = async (locationId: unknown, type: RefreshType, now: Date, hours: number): Promise<{ previous: Date | null } | false> => {
	const path = lastManualPath(type);
	const cutoff = addHours(now, -hours);
	const before = await Location.findOneAndUpdate(
		{ _id: locationId, $or: [{ [path]: null }, { [path]: { $exists: false } }, { [path]: { $lte: cutoff } }] },
		{ $set: { [path]: now } },
		{ new: false },
	).lean<ILocation>();
	if (!before) return false;
	return { previous: before.refresh?.last_manual?.[type] ?? null };
};

const releaseSlot = (locationId: unknown, type: RefreshType, previous: Date | null) =>
	Location.updateOne({ _id: locationId }, { $set: { [lastManualPath(type)]: previous } });

export const refreshLocation = async (
	location: ILocation,
	userId: UserId,
	requested: RefreshType[] | undefined,
	deps: RefreshDeps = {},
): Promise<RefreshResult> => {
	const now = deps.now ?? new Date();
	const hours = deps.minIntervalHours ?? config.refresh.minIntervalHours;
	const enqueueRun = deps.enqueueRun ?? ((loc: ILocation, uid: UserId) => enqueueRankRun(loc, uid, 'manual'));
	const enqueueSync = deps.enqueueSync ?? ((loc: ILocation, uid: UserId) => enqueueGbpSync(loc, uid, 'manual'));
	const bound = Boolean(await UserGBP.exists({ location_id: location._id, is_active: true }));
	const types: RefreshType[] = requested && requested.length > 0 ? [...new Set(requested)] : bound ? ['rankings', 'gbp'] : ['rankings'];
	const result: RefreshResult = { all_rate_limited: false };
	let limited = 0;
	const organizationId = location.organization_id as Types.ObjectId | undefined;
	const costs = deps.costs ?? (organizationId ? (await loadEntitlement(String(organizationId), now)).entitlement.tokens.cost_per_refresh : { rankings: 0, gbp: 0 });

	// Tokens: everything that would be newly queued must be affordable before anything is queued.
	if (organizationId) {
		const payable: RefreshType[] = [];
		for (const type of types) {
			if (type === 'gbp' && !bound) continue;
			const active = type === 'rankings' ? await RankRun.exists({ location_id: location._id, active: true }) : await GbpSync.exists({ location_id: location._id, active: true });
			const last = (await Location.findById(location._id).lean<ILocation>())?.refresh?.last_manual?.[type] ?? null;
			const limitedNow = last && addHours(new Date(last), hours).getTime() > now.getTime();
			if (!active && !limitedNow && costs[type] > 0) payable.push(type);
		}
		const cost = payable.reduce((s, t) => s + costs[t], 0);
		const balance = (await Organization.findById(organizationId).select({ token_balance: 1 }).lean<{ token_balance?: number }>())?.token_balance ?? 0;
		if (cost > balance) throw insufficientTokens(balance, cost, costs);
	}

	for (const type of types) {
		if (type === 'gbp' && !bound) {
			result.gbp = { skipped: 'gbp_not_connected', next_allowed_at: null };
			continue;
		}
		const stored = (await Location.findById(location._id).lean<ILocation>())?.refresh?.last_manual?.[type] ?? null;

		// Something already in progress: return it without using up the limit.
		const active =
			type === 'rankings'
				? await RankRun.exists({ location_id: location._id, active: true })
				: await GbpSync.exists({ location_id: location._id, active: true });
		if (active) {
			if (type === 'rankings') result.rankings = { ...(await enqueueRun(location, userId)), next_allowed_at: nextAllowed(stored, hours) };
			else result.gbp = { ...(await enqueueSync(location, userId)), next_allowed_at: nextAllowed(stored, hours) };
			continue;
		}

		const slot = await claimSlot(location._id, type, now, hours);
		if (!slot) {
			limited += 1;
			const skipped = { skipped: 'rate_limited' as const, next_allowed_at: nextAllowed(stored, hours) };
			if (type === 'rankings') result.rankings = skipped;
			else result.gbp = skipped;
			continue;
		}
		const paid = organizationId && costs[type] > 0 ? await spend(organizationId, costs[type], { location_id: location._id as Types.ObjectId, actor: { kind: 'user', id: new Types.ObjectId(String(userId)), name: null }, note: `Manual ${type} refresh` }, now) : null;
		if (paid && !paid.ok) {
			await releaseSlot(location._id, type, slot.previous);
			throw insufficientTokens(paid.balance, costs[type], costs);
		}
		let queued: { existing: boolean; id: string };
		try {
			if (type === 'rankings') {
				const r = await enqueueRun(location, userId);
				result.rankings = { ...r, next_allowed_at: addHours(now, hours) };
				queued = { existing: r.existing, id: r.run_id };
			} else {
				const r = await enqueueSync(location, userId);
				result.gbp = { ...r, next_allowed_at: addHours(now, hours) };
				queued = { existing: r.existing, id: r.sync_id };
			}
		} catch (err) {
			await releaseSlot(location._id, type, slot.previous); // nothing was queued: give the slot back
			if (paid?.entry_id) await refundUnused(paid.entry_id, 'nothing was queued');
			throw err;
		}
		if (paid?.entry_id) {
			// A run / sync started in between: nothing new was queued, so nothing is charged.
			if (queued.existing) await refundUnused(paid.entry_id, 'already in progress');
			else await linkSpend(paid.entry_id, refreshRef(type, queued.id));
		}
	}
	result.all_rate_limited = limited > 0 && limited === types.filter((t) => t !== 'gbp' || bound).length;
	// 7c: the report generated after this refresh also refetches competitor Place Details (> 24 h old).
	if (!result.all_rate_limited && (result.rankings || (result.gbp && !('skipped' in result.gbp)))) {
		await forceCompetitorRefresh(location._id as Types.ObjectId, now);
	}
	return result;
};

const insufficientTokens = (balance: number, cost: number, costs: Record<RefreshType, number>) =>
	apiErrorWithData(httpStatus.PAYMENT_REQUIRED, 'Not enough tokens for this refresh.', { reason: 'insufficient_tokens', balance, cost, costs_by_type: costs });

const refundUnused = async (entryId: string, why: string) => {
	const ref = `unused:${entryId}`;
	await linkSpend(entryId, ref);
	await refundSpend(ref, `Refund: ${why}`);
};

export interface RefreshState {
	frequency: 'auto_monthly' | 'manual_only';
	gbp_connected: boolean;
	next_refresh_at: Date | null;
	last_auto_refresh_at: Date | null;
	rankings: { next_allowed_at: Date | null; active_run: { run_id: string; status: string } | null };
	gbp: { next_allowed_at: Date | null; active_sync: { sync_id: string; status: string } | null; last_synced_at: Date | null } | null;
	/**
	 * 2026-10-02: reviews. They are stored by every GBP sync (v4) and by the Refresh Reviews button (synchronous,
	 * once per REVIEWS_REFRESH_MIN_MINUTES). Nothing about reviews or AI runs in the background otherwise.
	 */
	reviews: { synced_with_gbp: boolean; in_progress: boolean; last_refreshed_at: Date | null; next_allowed_at: Date | null; last_synced_at: Date | null } | null;
	/** 7c: the GBP report generation (pending after a run or sync finishes, debounced). */
	report: ReportState;
	/** Phase 13a: tokens per manual refresh type and the organization's balance. */
	tokens: { cost: Record<RefreshType, number>; balance: number };
}

/** Button state for the frontend (GET /locations/:id/refresh). */
export const getRefreshState = async (location: ILocation, now: Date = new Date(), hours: number = config.refresh.minIntervalHours): Promise<RefreshState> => {
	const fresh = (await Location.findById(location._id).lean<ILocation>()) ?? location;
	const bound = Boolean(await UserGBP.exists({ location_id: location._id, is_active: true }));
	const allowed = (type: RefreshType): Date | null => {
		const at = nextAllowed(fresh.refresh?.last_manual?.[type], hours);
		return at && at.getTime() > now.getTime() ? at : null;
	};
	const run = await RankRun.findOne({ location_id: location._id, active: true }).select({ status: 1 }).lean();
	const sync = bound ? await GbpSync.findOne({ location_id: location._id, active: true }).select({ status: 1 }).lean() : null;
	return {
		frequency: withDefaults(fresh.tracking).frequency,
		gbp_connected: bound,
		next_refresh_at: fresh.refresh?.next_refresh_at ?? null,
		last_auto_refresh_at: fresh.refresh?.last_auto_refresh_at ?? null,
		rankings: { next_allowed_at: allowed('rankings'), active_run: run ? { run_id: String(run._id), status: run.status } : null },
		gbp: bound
			? {
					next_allowed_at: allowed('gbp'),
					active_sync: sync ? { sync_id: String(sync._id), status: sync.status } : null,
					last_synced_at: fresh.gbp_sync?.last_synced_at ?? null,
				}
			: null,
		reviews: bound
			? {
					synced_with_gbp: config.gbp.v4Enabled,
					// A running GBP sync is also fetching reviews (v4).
					in_progress: Boolean(sync) && config.gbp.v4Enabled,
					last_refreshed_at: fresh.reviews_refreshed_at ?? null,
					next_allowed_at: (() => {
						const at = fresh.reviews_refreshed_at ? new Date(fresh.reviews_refreshed_at.getTime() + config.reviews.refreshMinMinutes * 60_000) : null;
						return at && at.getTime() > now.getTime() ? at : null;
					})(),
					last_synced_at: config.gbp.v4Enabled ? (fresh.gbp_sync?.last_synced_at ?? null) : null,
				}
			: null,
		report: reportState(fresh, now),
		tokens: await tokenState(fresh),
	};
};

const tokenState = async (location: ILocation): Promise<RefreshState['tokens']> => {
	if (!location.organization_id) return { cost: { rankings: 0, gbp: 0 }, balance: 0 };
	const { entitlement } = await loadEntitlement(String(location.organization_id));
	return { cost: entitlement.tokens.cost_per_refresh, balance: entitlement.tokens.balance };
};

export const invalidRefreshTypes = (types: unknown): ApiError | null => {
	if (types === undefined) return null;
	if (!Array.isArray(types) || types.some((t) => !REFRESH_TYPES.includes(t as RefreshType))) {
		return new ApiError(httpStatus.BAD_REQUEST, `types must be a list of: ${REFRESH_TYPES.join(', ')}`);
	}
	return null;
};
