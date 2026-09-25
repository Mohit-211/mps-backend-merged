import httpStatus from 'http-status';
import { Agenda } from 'agenda';
import { Types } from 'mongoose';
import config from '../../configs/config';
import { getAgenda } from '../../configs/agenda';
import logger from '../../configs/logger';
import { scheduleJob } from '../../jobs/defineJob';
import { JOB_NAMES } from '../../jobs/jobNames';
import { ILocation } from '../../models/location.model';
import { IRankRun, RankRun, RankRunStatus, RankRunTrigger } from '../../models/rankRun.model';
import { CallEstimate, regionFromCountry } from '../../ranking';
import { ApiError } from '../../utils';
import { RunPlanOptions, planRun } from './runPlan';
import { withDefaults } from './trackingSettings';

// Enqueue, read and list rank runs (CLAUDE.md §9.3/§9.4). One active (queued|running) run per
// location, enforced by the unique partial index on RankRun; the job data is { run_id } only.

export class RunOverCapError extends ApiError {
	readonly estimate: CallEstimate;
	readonly cap: number;

	constructor(estimate: CallEstimate, cap: number) {
		super(
			httpStatus.UNPROCESSABLE_ENTITY,
			`Estimated up to ${estimate.idsOnly.max} IDs-only calls, above RANK_MAX_CALLS_PER_RUN (${cap}). Reduce keywords or grid size.`,
		);
		this.estimate = estimate;
		this.cap = cap;
	}
}

export interface EnqueueResult {
	run_id: string;
	status: RankRunStatus;
	existing: boolean;
	estimate: CallEstimate;
	dev_capped: boolean;
}

export interface EnqueueDeps {
	agenda?: Agenda;
	now?: Date;
	planOptions?: RunPlanOptions;
}

const DUPLICATE_KEY = 11000;

const existingResult = (run: IRankRun): EnqueueResult => ({
	run_id: String(run._id),
	status: run.status,
	existing: true,
	estimate: run.estimate,
	dev_capped: run.dev_capped,
});

const findActiveRun = (locationId: Types.ObjectId | string) =>
	RankRun.findOne({ location_id: locationId, active: true });

/** Creates a queued run and schedules the rank-run job, or returns the location's active run. */
export const enqueueRankRun = async (
	location: ILocation,
	userId: Types.ObjectId | string,
	trigger: RankRunTrigger,
	deps: EnqueueDeps = {},
): Promise<EnqueueResult> => {
	const tracking = withDefaults(location.tracking);
	if (!location.place_id) throw new ApiError(httpStatus.BAD_REQUEST, 'Location has no place_id');
	if (tracking.keywords.length === 0) throw new ApiError(httpStatus.BAD_REQUEST, 'Location has no tracking keywords');
	let region: 'us' | 'ca';
	try {
		region = regionFromCountry(location.country);
	} catch (err) {
		throw new ApiError(httpStatus.BAD_REQUEST, (err as Error).message);
	}

	const active = await findActiveRun(location._id as Types.ObjectId);
	if (active) return existingResult(active);

	const plan = planRun(location, tracking, deps.planOptions);
	if (plan.overCap) throw new RunOverCapError(plan.estimate, plan.cap);

	let run: IRankRun;
	try {
		run = await RankRun.create({
			location_id: location._id,
			created_by: userId,
			trigger,
			status: 'queued',
			active: true,
			run_at: deps.now ?? new Date(),
			keywords_version: tracking.keywords_version,
			keywords: plan.keywords.map((k) => k.text),
			region,
			config: {
				grid_size: plan.gridSize,
				spacing_km: plan.spacingKm,
				tracker_offset_km: plan.offsetKm,
				radius_m: plan.radiusM,
				store_place_names: config.ranking.storePlaceNames,
			},
			targets: [
				{ key: 'self', place_id: location.place_id },
				...tracking.competitors.map((placeId, i) => ({ key: `competitor_${i + 1}`, place_id: placeId })),
			],
			estimate: plan.estimate,
			dev_capped: plan.devCapped,
		});
	} catch (err) {
		// Another request created the active run between our check and insert.
		if ((err as { code?: number }).code === DUPLICATE_KEY) {
			const winner = await findActiveRun(location._id as Types.ObjectId);
			if (winner) return existingResult(winner);
		}
		throw err;
	}

	try {
		await scheduleJob(deps.agenda ?? getAgenda(), JOB_NAMES.RANK_RUN, deps.now ?? new Date(), { run_id: String(run._id) });
	} catch (err) {
		await RankRun.updateOne(
			{ _id: run._id },
			{ $set: { status: 'failed', active: false, failure_reason: 'could not schedule the rank-run job' } },
		);
		logger.error(`rank-run scheduling failed for run ${String(run._id)}: ${(err as Error).message}`);
		throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Could not schedule the rank run');
	}

	return { run_id: String(run._id), status: run.status, existing: false, estimate: plan.estimate, dev_capped: plan.devCapped };
};

export const getRunForLocation = async (locationId: Types.ObjectId | string, runId: string): Promise<IRankRun> => {
	if (!Types.ObjectId.isValid(runId)) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid runId');
	const run = await RankRun.findOne({ _id: runId, location_id: locationId });
	if (!run) throw new ApiError(httpStatus.NOT_FOUND, 'Rank run not found');
	return run;
};

export const runStatusView = (run: IRankRun) => ({
	run_id: String(run._id),
	status: run.status,
	trigger: run.trigger,
	run_at: run.run_at,
	started_at: run.started_at,
	finished_at: run.finished_at,
	duration_ms: run.duration_ms,
	keywords_version: run.keywords_version,
	keywords: run.keywords,
	api_calls: run.api_calls,
	estimate: run.estimate,
	dev_capped: run.dev_capped,
	errors_count: run.run_errors.length,
	failure_reason: run.failure_reason,
});

export const listRuns = async (locationId: Types.ObjectId | string, page: number, limit: number) => {
	const filter = { location_id: locationId };
	const [runs, total] = await Promise.all([
		RankRun.find(filter)
			.sort({ run_at: -1 })
			.skip((page - 1) * limit)
			.limit(limit)
			.select({ status: 1, run_at: 1, keywords_version: 1, overall: 1, trigger: 1 })
			.lean(),
		RankRun.countDocuments(filter),
	]);
	return {
		runs: runs.map((r) => ({
			run_id: String(r._id),
			run_at: r.run_at,
			status: r.status,
			trigger: r.trigger,
			keywords_version: r.keywords_version,
			overall: r.overall ?? {},
		})),
		page,
		limit,
		total,
	};
};
