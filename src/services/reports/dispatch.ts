import { Types } from 'mongoose';
import { getAgenda } from '../../configs/agenda';
import logger from '../../configs/logger';
import { scheduleJob } from '../../jobs/defineJob';
import { JOB_NAMES } from '../../jobs/jobNames';
import { ILocation, Location, Report, ReportSchedule } from '../../models';
import { createReportEmailService } from './reportEmail.service';

// Scheduled-report plumbing (Phase 12): the request made after a location's GBP report, and the
// email job body. Both are best-effort for their callers and record failures on the schedule.

/** Called after a GBP report generation: queues report-schedule-dispatch if the location has schedules. Never throws. */
export const requestScheduleDispatch = async (locationId: Types.ObjectId | string, enqueue?: (data: { location_id: string }) => Promise<void>): Promise<void> => {
	try {
		const location = await Location.findById(locationId).select({ organization_id: 1, client_id: 1 }).lean<Pick<ILocation, 'organization_id' | 'client_id'>>();
		if (!location) return;
		const or: Record<string, unknown>[] = [{ scope: 'location', location_id: locationId }];
		if (location.client_id) or.push({ scope: 'client', client_id: location.client_id });
		const any = await ReportSchedule.exists({ organization_id: location.organization_id, status: 'active', $or: or });
		if (!any) return;
		if (enqueue) await enqueue({ location_id: String(locationId) });
		else await scheduleJob(getAgenda(), JOB_NAMES.REPORT_SCHEDULE_DISPATCH, new Date(), { location_id: String(locationId) });
	} catch (err) {
		logger.error(`reports: schedule dispatch request for location ${String(locationId)} failed: ${(err as Error).message}`);
	}
};

/** report-email job body: emails a scheduled report to the schedule's recipients. */
export const sendScheduledReport = async (
	reportId: string,
	scheduleId: string,
	service: ReturnType<typeof createReportEmailService> = createReportEmailService(),
): Promise<'sent' | 'skipped' | 'failed'> => {
	const [schedule, report] = await Promise.all([ReportSchedule.findById(scheduleId).lean(), Report.findById(reportId)]);
	if (!schedule || schedule.status !== 'active' || !report || report.status !== 'ready') return 'skipped';
	try {
		await service.send(report, schedule.recipients, { message: null, sentBy: null, rateLimited: false });
		await ReportSchedule.updateOne({ _id: schedule._id }, { $set: { last_sent_at: new Date(), last_error: null, last_report_id: report._id } });
		return 'sent';
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await ReportSchedule.updateOne({ _id: schedule._id }, { $set: { last_error: `email failed: ${message}`.slice(0, 300) } });
		logger.error(`reports: scheduled email for report ${reportId} failed: ${message}`);
		return 'failed';
	}
};
