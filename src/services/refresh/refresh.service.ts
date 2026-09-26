import { Types } from 'mongoose';
import httpStatus from 'http-status';
import config from '../../configs/config';
import { GbpSync, ILocation, Location, RankRun, RefreshType, UserGBP } from '../../models';
import { ApiError } from '../../utils';
import { ReportState, forceCompetitorRefresh, reportState } from '../gbp/report.service';
import { SyncEnqueueResult, enqueueGbpSync } from '../gbp/sync.service';
import { EnqueueResult, enqueueRankRun } from '../ranking/rankRun.service';
import { withDefaults } from '../ranking/trackingSettings';

// Manual refresh (Mohit, 2026-09-26): POST /locations/:id/refresh queues a rank run and/or a GBP sync,
// at most once per REFRESH_MIN_INTERVAL_HOURS per location per type. The limit is claimed with a
// compare-and-set on refresh.last_manual.<type>, so parallel clicks can't double-queue. A run/sync
// already in progress is returned instead and doesn't use up the limit.

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
		try {
			if (type === 'rankings') result.rankings = { ...(await enqueueRun(location, userId)), next_allowed_at: addHours(now, hours) };
			else result.gbp = { ...(await enqueueSync(location, userId)), next_allowed_at: addHours(now, hours) };
		} catch (err) {
			await releaseSlot(location._id, type, slot.previous); // nothing was queued: give the slot back
			throw err;
		}
	}
	result.all_rate_limited = limited > 0 && limited === types.filter((t) => t !== 'gbp' || bound).length;
	// 7c: the report generated after this refresh also refetches competitor Place Details (> 24 h old).
	if (!result.all_rate_limited && (result.rankings || (result.gbp && !('skipped' in result.gbp)))) {
		await forceCompetitorRefresh(location._id as Types.ObjectId, now);
	}
	return result;
};

export interface RefreshState {
	frequency: 'auto_monthly' | 'manual_only';
	gbp_connected: boolean;
	next_refresh_at: Date | null;
	last_auto_refresh_at: Date | null;
	rankings: { next_allowed_at: Date | null; active_run: { run_id: string; status: string } | null };
	gbp: { next_allowed_at: Date | null; active_sync: { sync_id: string; status: string } | null; last_synced_at: Date | null } | null;
	/** 7c: the GBP report generation (pending after a run or sync finishes, debounced). */
	report: ReportState;
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
		report: reportState(fresh, now),
	};
};

export const invalidRefreshTypes = (types: unknown): ApiError | null => {
	if (types === undefined) return null;
	if (!Array.isArray(types) || types.some((t) => !REFRESH_TYPES.includes(t as RefreshType))) {
		return new ApiError(httpStatus.BAD_REQUEST, `types must be a list of: ${REFRESH_TYPES.join(', ')}`);
	}
	return null;
};
