import { Agenda } from 'agenda';
import { onRankRunFinished } from '../gbp/hooks';
import { RankRun } from '../models/rankRun.model';
import { executeRankRun } from '../services/ranking/rankRunExecutor';
import { withLocationUsage } from '../services/usage/jobScope';
import { flushUsage } from '../services/usage/scope';
import { defineJob } from './defineJob';
import { JOB_NAMES } from './jobNames';

// rank-run: executes one queued RankRun. Job data is { run_id } only. The outcome (done, partial,
// failed and why) is stored on the RankRun itself, so the job does not throw for a failed run.
// A done or partial run then requests a GBP report (Phase 7c).
export const defineRankRunJob = (agenda: Agenda): void =>
	defineJob<{ run_id: string }>(agenda, {
		name: JOB_NAMES.RANK_RUN,
		concurrency: 2,
		lockLifetimeMs: 35 * 60 * 1000,
		handler: async ({ run_id }, job) => {
			const run = await RankRun.findById(run_id).select({ location_id: 1 }).lean<{ location_id: unknown }>();
			// Phase 12.5: long runs keep their agenda lock (touch) and write usage every minute.
			await withLocationUsage(run ? String(run.location_id) : null, () =>
				executeRankRun(run_id, {
					heartbeat: async () => {
						await job.touch();
						await flushUsage();
					},
				}),
			);
			await onRankRunFinished(run_id);
		},
	});
