import { Agenda } from 'agenda';
import { Types } from 'mongoose';
import { getAgenda } from '../../configs/agenda';
import logger from '../../configs/logger';
import { JOB_NAMES } from '../../jobs/jobNames';
import { GbpSync, ILocation, Location, RankRun, UserGBP } from '../../models';
import { bindingService } from '../gbp/binding.service';
import { OrgContext } from '../org/context';
import { usageFor } from '../org/limits';

// Soft delete (Phase 8): the location is deactivated and hidden, its jobs are cancelled, its GBP
// binding removed (tokens kept unless it was the connection's last binding). History (rank runs, syncs,
// reports) is kept. The slot counts against the plan limit no more, immediately.

export interface RemoveDeps {
	agenda?: Agenda;
	unbind?: (userId: string, locationId: string) => Promise<unknown>;
	now?: Date;
}

/** The soft delete itself, for any caller (DELETE /locations/:id, and disconnecting a Google account). */
export const softDeleteLocation = async (location: ILocation, actorUserId: string, deps: RemoveDeps = {}) => {
	const ctx = { userId: actorUserId };
	const agenda = deps.agenda ?? getAgenda();
	const now = deps.now ?? new Date();
	const id = location._id as Types.ObjectId;
	const ids = [String(id), id];

	let gbpUnbound = false;
	if (await UserGBP.exists({ location_id: id, is_active: true })) {
		await (deps.unbind ?? ((u, l) => bindingService.unbindLocation(u, l)))(ctx.userId, String(id));
		gbpUnbound = true;
	}
	// Queued runs and syncs are ended so the one-active guards free up, then their jobs are cancelled.
	const runs = await RankRun.find({ location_id: id, active: true }).select({ _id: 1 }).lean();
	const syncs = await GbpSync.find({ location_id: id, active: true }).select({ _id: 1 }).lean();
	await RankRun.updateMany({ location_id: id, active: true }, { $set: { status: 'failed', active: false, finished_at: now, failure_reason: 'location deleted' } });
	await GbpSync.updateMany({ location_id: id, active: true }, { $set: { status: 'failed', active: false, finished_at: now, failure_reason: 'location deleted' } });
	const cancelled = {
		rank_run: (await agenda.cancel({ name: JOB_NAMES.RANK_RUN, 'data.run_id': { $in: runs.map((r) => String(r._id)) } })) ?? 0,
		gbp_sync: (await agenda.cancel({ name: JOB_NAMES.GBP_SYNC, 'data.sync_id': { $in: syncs.map((s) => String(s._id)) } })) ?? 0,
		gbp_report: (await agenda.cancel({ name: JOB_NAMES.GBP_REPORT, 'data.location_id': { $in: ids } })) ?? 0,
	};
	await Location.updateOne(
		{ _id: id },
		{ $set: { is_active: false, deleted_at: now, deleted_by: ctx.userId, 'refresh.next_refresh_at': null, 'gbp_report.scheduled_for': null } },
	);
	logger.info(`locations: location ${String(id)} deleted (soft) by user ${ctx.userId}`);
	return { deleted: true as const, gbp_unbound: gbpUnbound, jobs_cancelled: cancelled };
};

export const removeLocation = async (ctx: OrgContext, location: ILocation, deps: RemoveDeps = {}) => {
	const result = await softDeleteLocation(location, ctx.userId, deps);
	const usage = await usageFor(ctx.organization);
	return { ...result, usage: usage.locations };
};
