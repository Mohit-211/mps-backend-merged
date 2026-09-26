import { Agenda } from 'agenda';
import { runMonthlyRefreshTick } from '../services/refresh/scheduler.service';
import { defineJob } from './defineJob';
import { JOB_NAMES } from './jobNames';

export const MONTHLY_REFRESH_INTERVAL = '15 minutes';

// monthly-refresh: every 15 minutes (see scheduleRecurringJobs). Agenda's lock means one process in
// the pm2 cluster runs it at a time; each location is additionally claimed atomically.
export const defineMonthlyRefreshJob = (agenda: Agenda): void =>
	defineJob<Record<string, string>>(agenda, {
		name: JOB_NAMES.MONTHLY_REFRESH,
		concurrency: 1,
		lockLifetimeMs: 10 * 60 * 1000,
		handler: async () => {
			await runMonthlyRefreshTick(new Date());
		},
	});
