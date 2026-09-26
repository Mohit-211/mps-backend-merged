import { Agenda } from 'agenda';
import { Types } from 'mongoose';
import httpStatus from 'http-status';
import config from '../../configs/config';
import { getAgenda } from '../../configs/agenda';
import { JOB_NAMES } from '../../jobs/jobNames';
import { scheduleJob } from '../../jobs/defineJob';
import { GBP_SYNC_TYPES, GbpSync, GbpSyncTrigger, ILocation, IGbpSync, UserGBP } from '../../models';
import { ApiError } from '../../utils';
import { WindowSettings, keywordMonths } from '../../gbp/windows';

// Queueing GBP syncs (Phase 7b): one active sync per location (unique partial index), job data
// { sync_id } only, like rank runs.

const DUPLICATE_KEY = 11000;

export interface SyncEnqueueResult {
	sync_id: string;
	status: string;
	existing: boolean;
	/** Minimum Google calls (each extra page of keywords / v4 lists adds one). Free, quota-limited. */
	estimated_calls: number;
}

export const syncSettings = (): WindowSettings => ({
	backfillMonths: config.gbp.backfillMonths,
	rollingDays: config.gbp.rollingDays,
	keywordBackfillMonths: config.gbp.keywordBackfillMonths,
	keywordRollingMonths: config.gbp.keywordRollingMonths,
});

/**
 * Minimum calls for one sync: performance 1, keywords 1 per month, profile 1, attributes 1, Google
 * edits 1, verification 1, plus 1 possible token refresh; with v4: reviews 1, media 1, customer media 1,
 * posts 1 (more pages add more).
 */
export const estimateSyncCalls = (backfill: boolean, v4Enabled: boolean, now: Date = new Date(), settings: WindowSettings = syncSettings()): number =>
	1 + keywordMonths(now, backfill, settings).length + 4 + 1 + (v4Enabled ? 4 : 0);

export class GbpNotBoundError extends ApiError {
	constructor() {
		super(httpStatus.BAD_REQUEST, 'This location is not connected to a Google Business Profile.');
	}
}

export interface SyncEnqueueDeps {
	agenda?: Agenda;
	now?: Date;
}

const view = (sync: Pick<IGbpSync, '_id' | 'status' | 'backfill'>, existing: boolean, now: Date): SyncEnqueueResult => ({
	sync_id: String(sync._id),
	status: sync.status,
	existing,
	estimated_calls: estimateSyncCalls(sync.backfill, config.gbp.v4Enabled, now),
});

/** The active sync of a location, if any. */
export const findActiveSync = (locationId: Types.ObjectId | string) => GbpSync.findOne({ location_id: locationId, active: true });

/** Queues a GBP sync for a bound location, or returns the one already queued or running. */
export const enqueueGbpSync = async (
	location: ILocation,
	userId: Types.ObjectId | string,
	trigger: GbpSyncTrigger,
	deps: SyncEnqueueDeps = {},
): Promise<SyncEnqueueResult> => {
	const now = deps.now ?? new Date();
	const binding = await UserGBP.findOne({ location_id: location._id, is_active: true }).lean();
	if (!binding) throw new GbpNotBoundError();

	const active = await findActiveSync(location._id as Types.ObjectId);
	if (active) return view(active, true, now);

	let sync: IGbpSync;
	try {
		sync = await GbpSync.create({
			location_id: location._id,
			created_by: userId,
			google_sub: binding.google_sub ?? null,
			gbp_location_id: binding.gbpLocationId,
			gbp_account_id: binding.gbpAccountId,
			trigger,
			status: 'queued',
			active: true,
			run_at: now,
			backfill: !location.gbp_sync?.backfilled_at,
			types: Object.fromEntries(GBP_SYNC_TYPES.map((t) => [t, { status: 'pending', message: null, rows: 0, range: null }])),
		});
	} catch (err) {
		if ((err as { code?: number }).code === DUPLICATE_KEY) {
			const raced = await findActiveSync(location._id as Types.ObjectId);
			if (raced) return view(raced, true, now);
		}
		throw err;
	}
	await scheduleJob(deps.agenda ?? getAgenda(), JOB_NAMES.GBP_SYNC, now, { sync_id: String(sync._id) });
	return view(sync, false, now);
};

const STUCK_AFTER_MS = 30 * 60 * 1000;

/** Fails syncs stuck in running (> 30 min) or never started (queued > 30 min), freeing their locations. */
export const failStuckSyncs = async (now: Date = new Date()): Promise<{ running: number; queued: number }> => {
	const cutoff = new Date(now.getTime() - STUCK_AFTER_MS);
	const running = await GbpSync.updateMany(
		{ status: 'running', started_at: { $lt: cutoff } },
		{ $set: { status: 'failed', active: false, finished_at: now, failure_reason: 'stuck: running > 30 min' } },
	);
	const queued = await GbpSync.updateMany(
		{ status: 'queued', run_at: { $lt: cutoff } },
		{ $set: { status: 'failed', active: false, finished_at: now, failure_reason: 'never started: queued > 30 min' } },
	);
	return { running: running.modifiedCount, queued: queued.modifiedCount };
};

export interface SyncStatusView {
	gbp_connected: boolean;
	sync: {
		sync_id: string;
		status: string;
		trigger: string;
		backfill: boolean;
		run_at: Date;
		started_at: Date | null;
		finished_at: Date | null;
		duration_ms: number | null;
		types: IGbpSync['types'];
		api_calls: IGbpSync['api_calls'];
		failure_reason: string | null;
	} | null;
	last_synced_at: Date | null;
}

/** GET /locations/:id/gbp/sync: the latest (or the given) sync of a location. */
export const getSyncStatus = async (location: ILocation, syncId?: string): Promise<SyncStatusView> => {
	const bound = Boolean(await UserGBP.exists({ location_id: location._id, is_active: true }));
	if (syncId !== undefined && !Types.ObjectId.isValid(syncId)) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid syncId');
	const sync = syncId
		? await GbpSync.findOne({ _id: syncId, location_id: location._id }).lean<IGbpSync>()
		: await GbpSync.findOne({ location_id: location._id }).sort({ run_at: -1 }).lean<IGbpSync>();
	if (syncId && !sync) throw new ApiError(httpStatus.NOT_FOUND, 'Sync not found');
	return {
		gbp_connected: bound,
		sync: sync
			? {
					sync_id: String(sync._id),
					status: sync.status,
					trigger: sync.trigger,
					backfill: sync.backfill,
					run_at: sync.run_at,
					started_at: sync.started_at,
					finished_at: sync.finished_at,
					duration_ms: sync.duration_ms,
					types: sync.types,
					api_calls: sync.api_calls,
					failure_reason: sync.failure_reason,
				}
			: null,
		last_synced_at: location.gbp_sync?.last_synced_at ?? null,
	};
};
