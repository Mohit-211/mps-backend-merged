import httpStatus from 'http-status';
import { Types } from 'mongoose';
import logger from '../../configs/logger';
import { ILocation, IReportSchedule, Location, ReportRangeParam, ReportSchedule, ReportType, ScheduleScope, UserGBP } from '../../models';
import { ApiError, apiErrorWithData } from '../../utils';
import { agencyOnly, findAccessibleClient, findAccessibleLocation } from '../org/access';
import { OrgContext } from '../org/context';
import { createReportService, recordScheduleError, resolveSections } from './report.service';

// Scheduled reports (Phase 12). Monthly only: a schedule fires once per monthly automatic refresh of
// each location it covers (a location, or every location of a client), right after that location's
// GBP report is generated (7c hook → report-schedule-dispatch). Manual refreshes don't fire it, and
// manual_only locations can't be scheduled. The report is emailed once generated (report-email).

type Id = Types.ObjectId | string;

export interface ScheduleInput {
	scope: ScheduleScope;
	location_id?: string;
	client_id?: string;
	type: ReportType;
	sections?: string[];
	range?: ReportRangeParam;
	recipients: string[];
}

export type ScheduleUpdate = Partial<Pick<ScheduleInput, 'type' | 'sections' | 'range' | 'recipients'>> & { status?: 'active' | 'paused' };

const cleanRecipients = (list: string[]): string[] => [...new Set(list.map((r) => r.trim().toLowerCase()))];

/** Schedules a context may see: the organization's, and for a client_user those of its clients. */
export const scheduleScope = (ctx: Pick<OrgContext, 'organization' | 'membership'>): Record<string, unknown> => ({
	organization_id: ctx.organization._id,
	...(ctx.membership.role === 'client_user' ? { client_id: { $in: ctx.membership.client_ids } } : {}),
});

type LocationForSchedule = Pick<ILocation, '_id' | 'name' | 'tracking' | 'refresh' | 'is_active'>;

/** When the next scheduled report is expected: the next monthly refresh of the covered location(s). */
export const nextExpected = (locations: LocationForSchedule[]): Date | null => {
	const dates = locations
		.filter((l) => l.is_active && (l.tracking?.frequency ?? 'auto_monthly') !== 'manual_only')
		.map((l) => l.refresh?.next_refresh_at)
		.filter((d): d is Date => d instanceof Date);
	return dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null;
};

export const createScheduleService = (deps: { reports?: ReturnType<typeof createReportService>; now?: () => Date } = {}) => {
	const reports = deps.reports ?? createReportService();
	const now = deps.now ?? (() => new Date());

	const coveredLocations = (s: Pick<IReportSchedule, 'scope' | 'location_id' | 'client_id' | 'organization_id'>) =>
		Location.find(
			s.scope === 'location'
				? { _id: s.location_id, is_active: true }
				: { organization_id: s.organization_id, client_id: s.client_id, is_active: true },
		)
			.select({ name: 1, tracking: 1, refresh: 1, is_active: 1 })
			.lean<LocationForSchedule[]>();

	const view = async (s: IReportSchedule) => {
		const locations = await coveredLocations(s);
		return {
			schedule_id: String(s._id),
			scope: s.scope,
			location_id: s.location_id ? String(s.location_id) : null,
			client_id: s.client_id ? String(s.client_id) : null,
			type: s.type,
			sections: s.sections,
			range: s.range,
			recipients: s.recipients,
			frequency: s.frequency,
			status: s.status,
			locations: locations.map((l) => ({ location_id: String(l._id), name: l.name })),
			next_expected: s.status === 'active' ? nextExpected(locations) : null,
			last_sent_at: s.last_sent_at,
			last_error: s.last_error,
			last_report_id: s.last_report_id ? String(s.last_report_id) : null,
			created_at: s.created_at,
		};
	};

	const load = async (ctx: OrgContext, scheduleId: string) => {
		if (!Types.ObjectId.isValid(scheduleId)) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid scheduleId');
		const s = await ReportSchedule.findOne({ _id: scheduleId, ...scheduleScope(ctx) });
		if (!s) throw new ApiError(httpStatus.NOT_FOUND, 'Schedule not found');
		return s;
	};

	const create = async (ctx: OrgContext, input: ScheduleInput) => {
		const sections = resolveSections(input.type, input.sections);
		let locationId: Types.ObjectId | null = null;
		let clientId: Types.ObjectId | null = null;
		if (input.scope === 'location') {
			const location = await findAccessibleLocation(ctx, input.location_id as string);
			if (!location) throw new ApiError(httpStatus.NOT_FOUND, 'Location not found');
			if (location.tracking?.frequency === 'manual_only') {
				throw apiErrorWithData(httpStatus.BAD_REQUEST, 'This location refreshes manually only, so it has no monthly cycle to schedule on.', { reason: 'manual_only' });
			}
			if (input.type === 'gbp_audit' && !(await UserGBP.exists({ location_id: location._id, is_active: true }))) {
				throw apiErrorWithData(httpStatus.BAD_REQUEST, 'Connect the Google Business Profile first.', { reason: 'gbp_not_connected' });
			}
			locationId = location._id as Types.ObjectId;
			clientId = (location.client_id as unknown as Types.ObjectId | null) ?? null;
		} else {
			if (ctx.organization.type !== 'agency') throw agencyOnly();
			const client = await findAccessibleClient(ctx, input.client_id as string);
			if (!client) throw new ApiError(httpStatus.NOT_FOUND, 'Client not found');
			clientId = client._id as Types.ObjectId;
		}
		const s = await ReportSchedule.create({
			organization_id: ctx.organization._id,
			scope: input.scope,
			location_id: locationId,
			client_id: clientId,
			type: input.type,
			sections,
			range: input.range ?? '28d',
			recipients: cleanRecipients(input.recipients),
			created_by: ctx.userId,
		});
		logger.info(`reports: schedule ${String(s._id)} (${input.scope}, ${input.type}) created in organization ${String(ctx.organization._id)}`);
		return view(s);
	};

	const list = async (ctx: OrgContext, query: { location_id?: string; client_id?: string; status?: 'active' | 'paused' }) => {
		const filter: Record<string, unknown> = { ...scheduleScope(ctx) };
		if (query.location_id) filter.location_id = new Types.ObjectId(query.location_id);
		if (query.client_id) filter.$and = [{ client_id: new Types.ObjectId(query.client_id) }];
		if (query.status) filter.status = query.status;
		const rows = await ReportSchedule.find(filter).sort({ created_at: -1, _id: -1 }).limit(200);
		return Promise.all(rows.map(view));
	};

	const get = async (ctx: OrgContext, scheduleId: string) => view(await load(ctx, scheduleId));

	const update = async (ctx: OrgContext, scheduleId: string, input: ScheduleUpdate) => {
		const s = await load(ctx, scheduleId);
		const type = input.type ?? s.type;
		if (input.type || input.sections) s.sections = resolveSections(type, input.sections ?? (input.type && input.type !== s.type ? undefined : s.sections));
		s.type = type;
		if (input.range) s.range = input.range;
		if (input.recipients) s.recipients = cleanRecipients(input.recipients);
		if (input.status) s.status = input.status;
		if (input.status === 'active') s.last_error = null;
		await s.save();
		return view(s);
	};

	const remove = async (ctx: OrgContext, scheduleId: string) => {
		const s = await load(ctx, scheduleId);
		await ReportSchedule.deleteOne({ _id: s._id });
		return { deleted: true, schedule_id: scheduleId };
	};

	/**
	 * report-schedule-dispatch: for each active schedule covering the location whose current monthly
	 * cycle (refresh.last_auto_refresh_at) isn't handled yet, claim the cycle (compare-and-set) and
	 * create the report. Returns the number of reports created.
	 */
	const dispatchForLocation = async (locationId: Id): Promise<number> => {
		const location = await Location.findOne({ _id: locationId, is_active: true }).lean<ILocation>();
		const cycle = location?.refresh?.last_auto_refresh_at ?? null;
		if (!location || !cycle || location.tracking?.frequency === 'manual_only') return 0;
		const or: Record<string, unknown>[] = [{ scope: 'location', location_id: location._id }];
		if (location.client_id) or.push({ scope: 'client', client_id: location.client_id });
		const schedules = await ReportSchedule.find({ organization_id: location.organization_id, status: 'active', $or: or }).lean<IReportSchedule[]>();
		let created = 0;
		const key = `cycles.${String(location._id)}`;
		for (const s of schedules) {
			const claimed = await ReportSchedule.updateOne({ _id: s._id, status: 'active', [key]: { $ne: cycle } }, { $set: { [key]: cycle } });
			if (claimed.modifiedCount === 0) continue;
			try {
				const r = await reports.createFor(location as unknown as ILocation, { type: s.type, sections: s.sections, range: s.range }, { trigger: 'schedule', schedule_id: s._id as Types.ObjectId, created_by: s.created_by });
				await ReportSchedule.updateOne({ _id: s._id }, { $set: { last_report_id: new Types.ObjectId(r.report_id) } });
				created += 1;
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				await recordScheduleError(s._id as Types.ObjectId, `${location.name}: ${message}`);
				logger.warn(`reports: schedule ${String(s._id)} could not create a report for location ${String(location._id)}: ${message}`);
			}
		}
		if (created) logger.info(`reports: ${created} scheduled report(s) created for location ${String(location._id)} (cycle ${cycle.toISOString()}) at ${now().toISOString()}`);
		return created;
	};

	return { create, list, get, update, remove, dispatchForLocation };
};

export const scheduleService = createScheduleService();
