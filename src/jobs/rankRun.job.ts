import { Agenda } from 'agenda';
import { onRankRunFinished } from '../gbp/hooks';
import { executeRankRun } from '../services/ranking/rankRunExecutor';
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
		handler: async ({ run_id }) => {
			await executeRankRun(run_id);
			await onRankRunFinished(run_id);
		},
	});
