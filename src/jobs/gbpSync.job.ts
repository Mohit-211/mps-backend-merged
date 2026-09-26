import { Agenda } from 'agenda';
import { executeGbpSync } from '../gbp/sync.executor';
import { defineJob } from './defineJob';
import { JOB_NAMES } from './jobNames';

// gbp-sync: executes one queued GbpSync. Job data is { sync_id } only. The outcome (per data type)
// is stored on the GbpSync document, so the job does not throw for a failed or partial sync.
export const defineGbpSyncJob = (agenda: Agenda): void =>
	defineJob<{ sync_id: string }>(agenda, {
		name: JOB_NAMES.GBP_SYNC,
		concurrency: 2,
		lockLifetimeMs: 20 * 60 * 1000,
		handler: async ({ sync_id }) => {
			await executeGbpSync(sync_id);
		},
	});
