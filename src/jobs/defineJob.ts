import { Agenda, Job } from 'agenda';
import logger from '../configs/logger';

// Conventions for new jobs (CLAUDE.md 3.4):
// - job data holds IDs only (string values), never documents or payloads (AUDIT C21);
// - every job declares its lockLifetime and concurrency;
// - handlers are idempotent; failures can be recorded on the related document via onFailure.

export type JobIdData = Record<string, string>;

export interface JobDefinition<T extends JobIdData> {
	name: string;
	/** Max runs of this job at once per process. */
	concurrency: number;
	/** How long a run keeps its lock before another process may take it over. */
	lockLifetimeMs: number;
	handler: (data: T, job: Job<T>) => Promise<void>;
	/** Called with the error when the handler throws (e.g. to write last_error / last_run_at). */
	onFailure?: (data: T, error: Error) => Promise<void>;
}

/** Throws unless every value is a non-empty string (an ID), so payloads cannot creep into job data. */
export const assertIdOnlyData = (name: string, data: unknown): void => {
	if (data === null || typeof data !== 'object' || Array.isArray(data)) {
		throw new Error(`Job "${name}": data must be an object of IDs`);
	}
	for (const [key, value] of Object.entries(data)) {
		if (typeof value !== 'string' || value.length === 0) {
			throw new Error(`Job "${name}": data.${key} must be a non-empty ID string`);
		}
	}
};

export const defineJob = <T extends JobIdData>(agenda: Agenda, definition: JobDefinition<T>): void => {
	agenda.define<T>(
		definition.name,
		{ concurrency: definition.concurrency, lockLifetime: definition.lockLifetimeMs },
		async (job: Job<T>) => {
			const started = Date.now();
			const data = job.attrs.data as T;
			const jobId = String(job.attrs._id);
			assertIdOnlyData(definition.name, data);
			logger.info(`job ${definition.name} started id=${jobId}`);
			try {
				await definition.handler(data, job);
				logger.info(`job ${definition.name} done id=${jobId} ${Date.now() - started}ms`);
			} catch (err) {
				const error = err instanceof Error ? err : new Error(String(err));
				logger.error(`job ${definition.name} failed id=${jobId} ${Date.now() - started}ms: ${error.message}`);
				if (definition.onFailure) {
					await definition.onFailure(data, error).catch((hookError: Error) =>
						logger.error(`job ${definition.name} onFailure hook failed: ${hookError.message}`),
					);
				}
				throw error;
			}
		},
	);
};

/** Schedules a job at `when` after validating that its data is IDs only. */
export const scheduleJob = async <T extends JobIdData>(
	agenda: Agenda,
	name: string,
	when: Date | string,
	data: T,
): Promise<Job> => {
	assertIdOnlyData(name, data);
	return agenda.schedule(when, name, data);
};
