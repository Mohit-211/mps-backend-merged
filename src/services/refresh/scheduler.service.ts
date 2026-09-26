import logger from '../../configs/logger';
import { ILocation, Location, RankRun, UserGBP } from '../../models';
import { enqueueGbpSync, failStuckSyncs } from '../gbp/sync.service';
import { enqueueRankRun } from '../ranking/rankRun.service';
import { nextRefreshAt, zoneFor } from './cadence';

// monthly-refresh job body (Mohit, 2026-09-26). Replaces the Phase 5 rank-scheduler. Runs every 15
// minutes; agenda's lock means one process in the pm2 cluster runs it at a time, and each location is
// additionally claimed with a compare-and-set on refresh.next_refresh_at.

export const STUCK_AFTER_MS = 30 * 60 * 1000;
const DUE_BATCH_LIMIT = 200;

/** Fails rank runs stuck in running (> 30 min) or never started (queued > 30 min), freeing their locations. */
export const failStuckRuns = async (now: Date = new Date()): Promise<{ running: number; queued: number }> => {
	const cutoff = new Date(now.getTime() - STUCK_AFTER_MS);
	const running = await RankRun.updateMany(
		{ status: 'running', started_at: { $lt: cutoff } },
		{ $set: { status: 'failed', active: false, finished_at: now, failure_reason: 'stuck: running > 30 min' } },
	);
	const queued = await RankRun.updateMany(
		{ status: 'queued', run_at: { $lt: cutoff } },
		{ $set: { status: 'failed', active: false, finished_at: now, failure_reason: 'never started: queued > 30 min' } },
	);
	return { running: running.modifiedCount, queued: queued.modifiedCount };
};

export interface RefreshSchedulerDeps {
	enqueueRun?: (location: ILocation) => Promise<unknown>;
	enqueueSync?: (location: ILocation) => Promise<unknown>;
	limit?: number;
}

export interface RefreshTickResult {
	due: number;
	refreshed: number;
	rank_runs: number;
	gbp_syncs: number;
	failed: number;
	stuck: { runs: number; syncs: number };
}

/**
 * One tick: stuck guards, then every due auto_monthly location (with keywords) gets its monthly
 * refresh: a rank run, and a GBP sync when it is bound. next_refresh_at moves to the next anchor
 * date first, so a failure never re-fires the same location on the next tick.
 */
export const runMonthlyRefreshTick = async (now: Date = new Date(), deps: RefreshSchedulerDeps = {}): Promise<RefreshTickResult> => {
	const enqueueRun =
		deps.enqueueRun ?? ((location: ILocation) => enqueueRankRun(location, String(location.created_by), 'scheduled'));
	const enqueueSync =
		deps.enqueueSync ?? ((location: ILocation) => enqueueGbpSync(location, String(location.created_by), 'scheduled'));

	const stuckRuns = await failStuckRuns(now);
	const stuckSyncs = await failStuckSyncs(now);
	const result: RefreshTickResult = {
		due: 0,
		refreshed: 0,
		rank_runs: 0,
		gbp_syncs: 0,
		failed: 0,
		stuck: { runs: stuckRuns.running + stuckRuns.queued, syncs: stuckSyncs.running + stuckSyncs.queued },
	};

	const due = await Location.find({
		is_active: true,
		'tracking.frequency': 'auto_monthly',
		'tracking.keywords.0': { $exists: true },
		'refresh.next_refresh_at': { $ne: null, $lte: now },
	})
		.sort({ 'refresh.next_refresh_at': 1 })
		.limit(deps.limit ?? DUE_BATCH_LIMIT);
	result.due = due.length;

	for (const location of due) {
		const refresh = location.refresh;
		if (!refresh?.next_refresh_at) continue;
		const next = nextRefreshAt(refresh.anchor_day, zoneFor(location), now);
		const claimed = await Location.findOneAndUpdate(
			{ _id: location._id, 'refresh.next_refresh_at': refresh.next_refresh_at },
			{ $set: { 'refresh.next_refresh_at': next, 'refresh.last_auto_refresh_at': now } },
			{ new: true },
		);
		if (!claimed) continue; // another tick claimed it
		result.refreshed += 1;
		if (!claimed.created_by) {
			result.failed += 1;
			await Location.updateOne({ _id: claimed._id }, { $set: { 'tracking.last_error': 'monthly refresh skipped: location has no owner' } });
			continue;
		}
		try {
			await enqueueRun(claimed);
			result.rank_runs += 1;
		} catch (err) {
			result.failed += 1;
			const message = (err as Error).message;
			await Location.updateOne({ _id: claimed._id }, { $set: { 'tracking.last_error': `monthly rank run not started: ${message}` } });
			logger.warn(`monthly-refresh: rank run for ${String(claimed._id)} not queued: ${message}`);
		}
		if (await UserGBP.exists({ location_id: claimed._id, is_active: true })) {
			try {
				await enqueueSync(claimed);
				result.gbp_syncs += 1;
			} catch (err) {
				result.failed += 1;
				const message = (err as Error).message;
				await Location.updateOne({ _id: claimed._id }, { $set: { 'gbp_sync.last_status': `not started: ${message}`.slice(0, 200) } });
				logger.warn(`monthly-refresh: gbp sync for ${String(claimed._id)} not queued: ${message}`);
			}
		}
	}
	if (result.due > 0 || result.stuck.runs > 0 || result.stuck.syncs > 0) {
		logger.info(
			`monthly-refresh: due=${result.due} refreshed=${result.refreshed} runs=${result.rank_runs} syncs=${result.gbp_syncs} failed=${result.failed} stuck=${result.stuck.runs}/${result.stuck.syncs}`,
		);
	}
	return result;
};
