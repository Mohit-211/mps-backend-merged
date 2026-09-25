import logger from '../../configs/logger';
import { ILocation, Location } from '../../models/location.model';
import { RankRun } from '../../models/rankRun.model';
import { enqueueRankRun } from './rankRun.service';
import { nextRunAfter } from './trackingSettings';

// rank-scheduler job body (CLAUDE.md §9.3; runs every 15 minutes, one process at a time via agenda's lock).

export const STUCK_AFTER_MS = 30 * 60 * 1000;
const DUE_BATCH_LIMIT = 200;

/** Fails runs stuck in running (> 30 min) or never started (queued > 30 min), freeing their locations. */
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
	if (running.modifiedCount || queued.modifiedCount) {
		logger.warn(`rank-scheduler: failed ${running.modifiedCount} stuck and ${queued.modifiedCount} never-started runs`);
	}
	return { running: running.modifiedCount, queued: queued.modifiedCount };
};

export interface ScheduleDeps {
	enqueue?: (location: ILocation) => Promise<unknown>;
	limit?: number;
}

export interface ScheduleResult {
	due: number;
	enqueued: number;
	failed: number;
}

/**
 * Enqueues a scheduled run for every due weekly/monthly location with at least one keyword, and
 * advances its next_run_at. Each location is claimed with a compare-and-set on next_run_at, so two
 * overlapping ticks never enqueue the same location twice. Manual locations are never picked.
 */
export const scheduleDueRuns = async (now: Date = new Date(), deps: ScheduleDeps = {}): Promise<ScheduleResult> => {
	const enqueue =
		deps.enqueue ?? ((location: ILocation) => enqueueRankRun(location, String(location.created_by), 'scheduled'));
	const due = await Location.find({
		is_active: true,
		'tracking.frequency': { $in: ['weekly', 'monthly'] },
		'tracking.next_run_at': { $ne: null, $lte: now },
		'tracking.keywords.0': { $exists: true },
	})
		.sort({ 'tracking.next_run_at': 1 })
		.limit(deps.limit ?? DUE_BATCH_LIMIT);

	const result: ScheduleResult = { due: due.length, enqueued: 0, failed: 0 };
	for (const location of due) {
		const tracking = location.tracking;
		if (!tracking?.next_run_at || tracking.frequency === 'manual') continue;
		const next = nextRunAfter(tracking.frequency, tracking.next_run_at, now);
		const claimed = await Location.findOneAndUpdate(
			{ _id: location._id, 'tracking.next_run_at': tracking.next_run_at },
			{ $set: { 'tracking.next_run_at': next } },
			{ new: true },
		);
		if (!claimed) continue; // another tick claimed it
		try {
			if (!claimed.created_by) throw new Error('Location has no owner (created_by)');
			await enqueue(claimed);
			result.enqueued += 1;
		} catch (err) {
			result.failed += 1;
			const message = (err as Error).message;
			await Location.updateOne({ _id: claimed._id }, { $set: { 'tracking.last_error': `scheduled run not started: ${message}` } });
			logger.warn(`rank-scheduler: location ${String(claimed._id)} not enqueued: ${message}`);
		}
	}
	if (result.due > 0) logger.info(`rank-scheduler: due=${result.due} enqueued=${result.enqueued} failed=${result.failed}`);
	return result;
};
