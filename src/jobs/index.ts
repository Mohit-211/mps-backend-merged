import { Agenda } from 'agenda';
import logger from '../configs/logger';
import { JOB_NAMES } from './jobNames';
import { defineAgendaJobs as definePostToGbpJob } from './postToGbp';
import { defineRankRunJob } from './rankRun.job';
import { RANK_SCHEDULER_INTERVAL, defineRankSchedulerJob } from './rankScheduler.job';

// The single job registry. src/server.ts calls defineAllJobs() before startAgenda(), then
// scheduleRecurringJobs() once agenda is running.

// Returns the names of all defined jobs.
export const defineAllJobs = (agenda: Agenda): string[] => {
	definePostToGbpJob(agenda);
	defineRankRunJob(agenda);
	defineRankSchedulerJob(agenda);
	const names = Object.keys((agenda as unknown as { _definitions: Record<string, unknown> })._definitions);
	logger.info(`Agenda jobs defined: ${names.join(', ')}`);
	return names;
};

/** Creates (or updates) the repeating jobs. agenda.every() keeps a single job document per name. */
export const scheduleRecurringJobs = async (agenda: Agenda): Promise<void> => {
	await agenda.every(RANK_SCHEDULER_INTERVAL, JOB_NAMES.RANK_SCHEDULER, {});
	logger.info(`Recurring job scheduled: ${JOB_NAMES.RANK_SCHEDULER} every ${RANK_SCHEDULER_INTERVAL}`);
};
