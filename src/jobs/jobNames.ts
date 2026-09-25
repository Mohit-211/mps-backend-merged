// Names of every agenda job. Phase 5 adds rank-run and rank-scheduler.
export const JOB_NAMES = {
	POST_TO_GBP: 'post-to-gbp',
} as const;

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];
