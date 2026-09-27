import { Agenda } from 'agenda';
import config from '../configs/config';
import { reportService } from '../services/reports/report.service';
import { scheduleService } from '../services/reports/schedule.service';
import { sendScheduledReport } from '../services/reports/dispatch';
import { defineJob } from './defineJob';
import { JOB_NAMES } from './jobNames';

// Reports center jobs (Phase 12). The PDF render is CPU work in-process: REPORT_RENDER_CONCURRENCY
// (default 1) per process, and agenda's lock keeps each report on one process.
export const REPORT_RETENTION_INTERVAL = '1 day';

export const defineReportJobs = (agenda: Agenda): void => {
	defineJob<{ report_id: string }>(agenda, {
		name: JOB_NAMES.REPORT_GENERATE,
		concurrency: config.reports.renderConcurrency,
		lockLifetimeMs: 10 * 60 * 1000,
		handler: async ({ report_id }) => {
			await reportService.generate(report_id);
		},
	});
	defineJob<{ report_id: string; schedule_id: string }>(agenda, {
		name: JOB_NAMES.REPORT_EMAIL,
		concurrency: 2,
		lockLifetimeMs: 5 * 60 * 1000,
		handler: async ({ report_id, schedule_id }) => {
			await sendScheduledReport(report_id, schedule_id);
		},
	});
	defineJob<{ location_id: string }>(agenda, {
		name: JOB_NAMES.REPORT_SCHEDULE_DISPATCH,
		concurrency: 1,
		lockLifetimeMs: 5 * 60 * 1000,
		handler: async ({ location_id }) => {
			await scheduleService.dispatchForLocation(location_id);
		},
	});
	defineJob<Record<string, string>>(agenda, {
		name: JOB_NAMES.REPORT_RETENTION,
		concurrency: 1,
		lockLifetimeMs: 30 * 60 * 1000,
		handler: async () => {
			await reportService.expireOld();
		},
	});
};
