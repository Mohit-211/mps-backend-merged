// Names of every agenda job.
export const JOB_NAMES = {
	POST_TO_GBP: 'post-to-gbp',
	RANK_RUN: 'rank-run',
	RANK_SCHEDULER: 'rank-scheduler',
} as const;

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];
