import logger from '../configs/logger';
import { GbpSync, IGbpSync, IRankRun, RankRun } from '../models';
import { requestReportSafely } from '../services/gbp/report.service';

// Extension points after a GBP sync or a rank run: both request a GBP report generation (Phase 7c).
// Requests are debounced in report.service, so a sync and a rank run finishing together give one report.

/** Called once a gbp-sync has finished (done, partial or failed). */
export const onGbpSyncFinished = async (syncId: string, status: IGbpSync['status']): Promise<void> => {
	const sync = await GbpSync.findById(syncId).select({ location_id: 1 }).lean();
	if (!sync) return;
	logger.debug(`gbp-sync ${syncId} finished (${status}); requesting a GBP report`);
	await requestReportSafely(sync.location_id, 'gbp_sync');
};

/** Called once a rank-run job has finished. A failed run changes nothing in the report, so it doesn't request one. */
export const onRankRunFinished = async (runId: string): Promise<void> => {
	const run = await RankRun.findById(runId).select({ location_id: 1, status: 1 }).lean<Pick<IRankRun, 'location_id' | 'status'>>();
	if (!run || (run.status !== 'done' && run.status !== 'partial')) return;
	await requestReportSafely(String(run.location_id), 'rank_run');
};
