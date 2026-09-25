/*
 * Agenda self-test against the configured database (local: mps_rebuild):
 *
 *   npm run smoke:agenda
 *
 * Defines a throwaway "agenda-self-test" job (only inside this script, so it never locks real
 * jobs), schedules it 10 seconds ahead, waits for it to run, removes it, and checks none remain.
 * Makes no external API calls. Safe to run while `npm run dev` is running.
 */
import { randomUUID } from 'crypto';
import { createAgenda, startAgenda, stopAgenda } from '../configs/agenda';
import { defineJob, scheduleJob } from '../jobs/defineJob';

const JOB_NAME = 'agenda-self-test';
const DELAY_MS = 10000;
const TIMEOUT_MS = 90000;

const main = async (): Promise<number> => {
	const agenda = createAgenda();
	const runId = randomUUID();
	let ranAt: number | undefined;

	defineJob<{ runId: string }>(agenda, {
		name: JOB_NAME,
		concurrency: 1,
		lockLifetimeMs: 60000,
		handler: async (data) => {
			if (data.runId === runId) ranAt = Date.now();
		},
	});

	try {
		await startAgenda(agenda);
		const scheduledAt = Date.now();
		const job = await scheduleJob(agenda, JOB_NAME, new Date(scheduledAt + DELAY_MS), { runId });
		process.stdout.write(`Scheduled ${JOB_NAME} (${String(job.attrs._id)}) to run in ${DELAY_MS / 1000}s...\n`);

		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error(`job did not run within ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS);
			agenda.on(`success:${JOB_NAME}`, () => {
				if (ranAt) {
					clearTimeout(timer);
					resolve();
				}
			});
			agenda.on(`fail:${JOB_NAME}`, (error: Error) => {
				clearTimeout(timer);
				reject(error);
			});
		});
		process.stdout.write(`Ran after ${((ranAt as number) - scheduledAt) / 1000}s.\n`);

		await job.remove();
		const remaining = await agenda.jobs({ name: JOB_NAME });
		process.stdout.write(`Removed. ${remaining.length} "${JOB_NAME}" job(s) left in agendaJobs.\n`);
		return remaining.length === 0 ? 0 : 1;
	} finally {
		await stopAgenda(agenda);
	}
};

main()
	.then((code) => process.exit(code))
	.catch((err: Error) => {
		process.stderr.write(`Agenda self-test failed: ${err.message}\n`);
		process.exit(1);
	});
