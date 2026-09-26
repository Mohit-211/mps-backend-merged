// Names of every agenda job.
export const JOB_NAMES = {
	POST_TO_GBP: 'post-to-gbp',
	RANK_RUN: 'rank-run',
	RANK_SCHEDULER: 'rank-scheduler',
	/** Phase 7. Declared now so unbind (C12) can cancel a location's sync jobs. */
	GBP_SYNC: 'gbp-sync',
} as const;

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];
