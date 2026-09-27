import { Agenda } from 'agenda';
import { executeGbpSync } from '../gbp/sync.executor';
import { GbpSync } from '../models';
import { withLocationUsage } from '../services/usage/jobScope';
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
			const sync = await GbpSync.findById(sync_id).select({ location_id: 1 }).lean<{ location_id: unknown }>();
			await withLocationUsage(sync ? String(sync.location_id) : null, () => executeGbpSync(sync_id));
		},
	});
