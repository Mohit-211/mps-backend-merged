import { Agenda } from 'agenda';
import logger from '../configs/logger';
import { JOB_NAMES } from './jobNames';
import { defineAgendaJobs as definePostToGbpJob } from './postToGbp';
import { defineRankRunJob } from './rankRun.job';
import { defineGbpSyncJob } from './gbpSync.job';
import { defineGbpReportJob } from './gbpReport.job';
import { MONTHLY_REFRESH_INTERVAL, defineMonthlyRefreshJob } from './monthlyRefresh.job';

// The single job registry. src/server.ts calls defineAllJobs() before startAgenda(), then
// scheduleRecurringJobs() once agenda is running.

// Returns the names of all defined jobs.
export const defineAllJobs = (agenda: Agenda): string[] => {
	definePostToGbpJob(agenda);
	defineRankRunJob(agenda);
	defineGbpSyncJob(agenda);
	defineGbpReportJob(agenda);
	defineMonthlyRefreshJob(agenda);
	const names = Object.keys((agenda as unknown as { _definitions: Record<string, unknown> })._definitions);
	logger.info(`Agenda jobs defined: ${names.join(', ')}`);
	return names;
};

/**
 * Creates (or updates) the repeating jobs. agenda.every() keeps a single job document per name.
 * 7b: the Phase 5 rank-scheduler is replaced by monthly-refresh; its old document is cancelled here.
 */
export const scheduleRecurringJobs = async (agenda: Agenda): Promise<void> => {
	const removed = await agenda.cancel({ name: JOB_NAMES.RANK_SCHEDULER });
	if (removed) logger.info(`Cancelled ${removed} old ${JOB_NAMES.RANK_SCHEDULER} job document(s)`);
	await agenda.every(MONTHLY_REFRESH_INTERVAL, JOB_NAMES.MONTHLY_REFRESH, {});
	logger.info(`Recurring job scheduled: ${JOB_NAMES.MONTHLY_REFRESH} every ${MONTHLY_REFRESH_INTERVAL}`);
};
