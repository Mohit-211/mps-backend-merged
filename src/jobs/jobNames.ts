// Names of every agenda job.
export const JOB_NAMES = {
	POST_TO_GBP: 'post-to-gbp',
	RANK_RUN: 'rank-run',
	/** Removed in 7b (replaced by monthly-refresh); kept so startup can cancel its old agenda document. */
	RANK_SCHEDULER: 'rank-scheduler',
	GBP_SYNC: 'gbp-sync',
	/** 7b: the location-level monthly refresh (rank run + GBP sync), every 15 minutes. */
	MONTHLY_REFRESH: 'monthly-refresh',
} as const;

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];
