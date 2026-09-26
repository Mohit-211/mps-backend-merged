import { Agenda } from 'agenda';
import { REPORT_TRIGGERS, ReportTrigger } from '../models';
import { runReportJob } from '../services/gbp/report.service';
import { defineJob } from './defineJob';
import { JOB_NAMES } from './jobNames';

// gbp-report: generates a location's GBP report (Phase 7c). Job data is { location_id, trigger }.
// Scheduled by report.service.requestReport (debounced); it skips while a rank run or sync is active.
export const defineGbpReportJob = (agenda: Agenda): void =>
	defineJob<{ location_id: string; trigger: string }>(agenda, {
		name: JOB_NAMES.GBP_REPORT,
		concurrency: 2,
		lockLifetimeMs: 10 * 60 * 1000,
		handler: async ({ location_id, trigger }) => {
			const known = (REPORT_TRIGGERS as readonly string[]).includes(trigger) ? (trigger as ReportTrigger) : 'gbp_sync';
			await runReportJob(location_id, known);
		},
	});
