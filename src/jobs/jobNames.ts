// Names of every agenda job.
export const JOB_NAMES = {
	POST_TO_GBP: 'post-to-gbp',
	RANK_RUN: 'rank-run',
	GBP_SYNC: 'gbp-sync',
	/** 7b: the location-level monthly refresh (rank run + GBP sync), every 15 minutes. */
	MONTHLY_REFRESH: 'monthly-refresh',
	/** 7c: generates a location's GBP report after a sync or rank run (debounced). */
	GBP_REPORT: 'gbp-report',
	/** Phase 12: renders one report (snapshot + PDF). */
	REPORT_GENERATE: 'report-generate',
	/** Phase 12: emails a scheduled report once it is ready. */
	REPORT_EMAIL: 'report-email',
	/** Phase 12: after a location's GBP report, creates the due scheduled reports. */
	REPORT_SCHEDULE_DISPATCH: 'report-schedule-dispatch',
	/** Phase 12: daily, deletes reports past REPORT_RETENTION_MONTHS. */
	REPORT_RETENTION: 'report-retention',
	/** Phase 8.1: hourly, deletes signups not verified within EMAIL_VERIFICATION_TTL_HOURS. */
	UNVERIFIED_CLEANUP: 'unverified-cleanup',
	/** Phase 13a: every 6 hours, renewal snapshots (PayPal price 11 days ahead), manual invoices, token expiry. */
	BILLING_RENEWALS: 'billing-renewals',
	/** Phase 13a: daily, trial-ending and overdue-invoice reminders. */
	BILLING_REMINDERS: 'billing-reminders',
} as const;

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];
