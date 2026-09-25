import { Agenda } from 'agenda';
import { failStuckRuns, scheduleDueRuns } from '../services/ranking/scheduler.service';
import { defineJob } from './defineJob';
import { JOB_NAMES } from './jobNames';

export const RANK_SCHEDULER_INTERVAL = '15 minutes';

// rank-scheduler: every 15 minutes (see scheduleRecurringJobs). Agenda's lock means one process in
// the pm2 cluster runs it at a time; each location is additionally claimed atomically.
export const defineRankSchedulerJob = (agenda: Agenda): void =>
	defineJob<Record<string, string>>(agenda, {
		name: JOB_NAMES.RANK_SCHEDULER,
		concurrency: 1,
		lockLifetimeMs: 10 * 60 * 1000,
		handler: async () => {
			const now = new Date();
			await failStuckRuns(now);
			await scheduleDueRuns(now);
		},
	});
