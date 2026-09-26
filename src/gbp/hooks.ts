import logger from '../configs/logger';
import { IGbpSync } from '../models';

// Extension points around a GBP sync. Phase 7c enqueues GBP report generation here after a sync.

/** Called once a gbp-sync has finished (done, partial or failed). Only logs until 7c. */
export const onGbpSyncFinished = async (syncId: string, status: IGbpSync['status']): Promise<void> => {
	logger.debug(`gbp-sync ${syncId} finished (${status}); report generation arrives in 7c`);
};
