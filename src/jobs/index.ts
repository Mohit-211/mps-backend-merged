import { Agenda } from 'agenda';
import logger from '../configs/logger';
import { defineAgendaJobs as definePostToGbpJob } from './postToGbp';

// The single job registry. Every job is defined here; src/server.ts calls this before startAgenda().
// Returns the names of all defined jobs.
export const defineAllJobs = (agenda: Agenda): string[] => {
	definePostToGbpJob(agenda);
	const names = Object.keys((agenda as unknown as { _definitions: Record<string, unknown> })._definitions);
	logger.info(`Agenda jobs defined: ${names.join(', ')}`);
	return names;
};
