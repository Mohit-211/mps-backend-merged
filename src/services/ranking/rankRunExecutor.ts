import { Types } from 'mongoose';
import logger from '../../configs/logger';
import { Sleep } from '../../clients/http';
import { PlacesApiError, PlacesClient, placesClient } from '../../clients/placesClient';
import { ILocation, Location } from '../../models/location.model';
import { RankResultList } from '../../models/rankResultList.model';
import { encodeResultLists, ListInput } from './resultLists';
import {
	GridSectionDoc,
	IRankRun,
	MapListSectionDoc,
	OverallDoc,
	RankRun,
	RankRunStatus,
	RunErrorDoc,
	SummaryDoc,
	TrackerSectionDoc,
	TrackerSummaryDoc,
} from '../../models/rankRun.model';
import {
	GeoPoint,
	KeywordSummary,
	RankCell,
	createRankingEngine,
	gridPoints,
	keywordChange,
	normaliseKeyword,
	overallAvgRank,
	overallChange,
	summarise,
	trackerPoints,
} from '../../ranking';
import { refundFailedRefresh } from '../billing/refreshTokens';

// The rank-run job body (CLAUDE.md §9.3). Loads the run, resolves the center, runs every keyword
// over tracker ∪ grid points through ONE engine (shared cache; Phase 12.5: full depth and N samples
// per point), stores every point's full result list (RankResultList), builds the Map Ranking lists
// (Phase 12.5: at the 5 tracker points), computes metrics and change vs the previous comparable run.

export type RunPlaces = Pick<PlacesClient, 'searchTextIds' | 'searchTextWithNames' | 'getPlaceDetails'>;

export interface ExecuteDeps {
	places?: RunPlaces;
	now?: () => Date;
	/** Engine timing overrides (tests and the offline demo use no jitter). */
	engine?: { sleep?: Sleep; random?: () => number; now?: () => number };
	/** Called every heartbeatMs while the run works (the job touches its agenda lock and flushes usage). */
	heartbeat?: () => Promise<void>;
	heartbeatMs?: number;
}

export interface ExecuteResult {
	status: RankRunStatus | 'skipped';
	runId: string;
}

type PreviousRun = Pick<IRankRun, 'tracker' | 'overall'> | null;

const cellsFor = (entries: { byTarget: Record<string, RankCell> }[], key: string): RankCell[] =>
	entries.map((e) => e.byTarget[key]);

const samePoint = (a: GeoPoint, b: GeoPoint): boolean =>
	a.lat.toFixed(5) === b.lat.toFixed(5) && a.lng.toFixed(5) === b.lng.toFixed(5);

const previousSummary = (previous: PreviousRun, keyword: string, key: string): KeywordSummary | null => {
	const section = previous?.tracker.find((t) => normaliseKeyword(t.keyword) === normaliseKeyword(keyword));
	const summary = section?.summary?.[key];
	return summary ? { avgRank: summary.avgRank, foundRate: summary.foundRate, top3Rate: summary.top3Rate } : null;
};

const finish = async (
	run: IRankRun,
	status: RankRunStatus,
	now: Date,
	fields: Record<string, unknown>,
	failureReason: string | null,
): Promise<void> => {
	const startedAt = run.started_at ?? now;
	await RankRun.updateOne(
		{ _id: run._id },
		{
			$set: {
				...fields,
				status,
				active: false,
				failure_reason: failureReason,
				finished_at: now,
				duration_ms: now.getTime() - startedAt.getTime(),
			},
		},
	);
	await Location.updateOne(
		{ _id: run.location_id },
		{ $set: { 'tracking.last_run_at': now, 'tracking.last_error': failureReason } },
	);
	// Phase 13a: a paid manual refresh that failed entirely gets its tokens back.
	if (status === 'failed') await refundFailedRefresh('rankings', run._id, failureReason ?? 'failed');
};

export const executeRankRun = async (runId: string, deps: ExecuteDeps = {}): Promise<ExecuteResult> => {
	const places = deps.places ?? placesClient;
	const clock = deps.now ?? (() => new Date());

	// Claim: only a queued run can start, so a retried or duplicated job is a no-op.
	const run = await RankRun.findOneAndUpdate(
		{ _id: new Types.ObjectId(runId), status: 'queued' },
		{ $set: { status: 'running', started_at: clock() } },
		{ new: true },
	);
	if (!run) {
		logger.info(`rank-run ${runId}: not queued any more, skipping`);
		return { status: 'skipped', runId };
	}

	const apiCalls = { ids_only: 0, pro: 0, details: 0 };
	const runErrors: RunErrorDoc[] = [];
	const beat = deps.heartbeat
		? setInterval(() => {
				deps.heartbeat?.().catch((err: Error) => logger.warn(`rank-run ${runId}: heartbeat failed: ${err.message}`));
			}, deps.heartbeatMs ?? 60_000)
		: null;

	try {
		const location: ILocation | null = await Location.findOne({ _id: run.location_id });
		if (!location) throw new Error('Location not found');

		// 1. Center: the location's lat/lng, or one Place Details call (field `location` only).
		let center: GeoPoint;
		let centerSource: 'location' | 'place_details';
		if (Number.isFinite(location.lat) && Number.isFinite(location.lng)) {
			center = { lat: location.lat as number, lng: location.lng as number };
			centerSource = 'location';
		} else {
			try {
				const result = await places.getPlaceDetails(location.place_id, ['location']);
				apiCalls.details += result.apiCalls;
				if (!result.details.location) throw new Error('Place Details returned no location');
				center = { lat: result.details.location.latitude, lng: result.details.location.longitude };
				centerSource = 'place_details';
				await Location.updateOne({ _id: location._id }, { $set: { lat: center.lat, lng: center.lng, center_source: 'place_details' } });
			} catch (err) {
				if (err instanceof PlacesApiError) apiCalls.details += err.apiCalls;
				throw new Error(`Could not resolve the location center: ${(err as Error).message}`);
			}
		}

		// 2. Rank every keyword over tracker ∪ grid points with one engine (shared cache).
		const engine = createRankingEngine({
			places,
			region: run.region,
			targets: run.targets.map((t) => ({ key: t.key as 'self', placeId: t.place_id })),
			radiusM: run.config.radius_m,
			samples: run.config.samples ?? 1,
			sampleSpacingMs: (run.config.sample_spacing_sec ?? 0) * 1000,
			...deps.engine,
		});
		const tPoints = trackerPoints(center, run.config.tracker_offset_km);
		const gPoints = gridPoints(center, run.config.grid_size, run.config.spacing_km);
		const ranked = await Promise.all(
			run.keywords.map(async (keyword) => {
				const [tracker, grid] = await Promise.all([
					engine.rankKeywordAtPoints(keyword, tPoints),
					engine.rankKeywordAtPoints(keyword, gPoints),
				]);
				return { keyword, tracker, grid };
			}),
		);
		const stats = engine.getStats();
		apiCalls.ids_only += stats.apiCalls.ids_only;
		for (const e of engine.getErrors()) {
			const onTracker = tPoints.some((p) => samePoint(p, e.point));
			runErrors.push({ keyword: e.keyword, section: onTracker ? 'tracker' : 'grid', point: e.point, message: e.message });
		}

		// 2b. Every point's full ordered result list (all samples), one document per keyword. The center
		// is stored once, as tracker point 'C' (the grid's center cell is the same search).
		await RankResultList.deleteMany({ run_id: run._id });
		const listDocs = ranked.map(({ keyword, tracker: tRanks, grid: gRanks }) => {
			const inputs: ListInput[] = [];
			for (const r of tRanks) r.samples.forEach((smp, i) => inputs.push({ point: r.point.label, sample: i, entries: smp.entries }));
			for (const r of gRanks) {
				if (tPoints.some((p) => samePoint(p, r.point))) continue;
				r.samples.forEach((smp, i) => inputs.push({ point: `g:${r.point.row},${r.point.col}`, sample: i, entries: smp.entries }));
			}
			return { run_id: run._id, location_id: run.location_id, keyword, ...encodeResultLists(inputs) };
		});
		if (listDocs.length) await RankResultList.insertMany(listDocs);

		// 3. Map Ranking lists: top 20 with names (Pro SKU, 1 page) at the 5 tracker points, or the center only.
		const mapList: MapListSectionDoc[] = [];
		const targetByPlace = new Map(run.targets.map((t) => [t.place_id, t.key]));
		const mapPoints = (run.config.map_points ?? 1) >= 5 ? tPoints : tPoints.filter((p) => p.label === 'C');
		for (const keyword of run.keywords) {
			for (const mp of mapPoints) {
				try {
					const result = await places.searchTextWithNames({
						textQuery: keyword,
						regionCode: run.region,
						center: { latitude: mp.lat, longitude: mp.lng },
						radiusM: run.config.radius_m,
					});
					apiCalls.pro += result.apiCalls;
					mapList.push({
						keyword,
						point: mp.label,
						results: result.places.slice(0, 20).map((p, i) => {
							const key = targetByPlace.get(p.id) ?? (p.movedPlaceId ? targetByPlace.get(p.movedPlaceId) : undefined);
							return {
								rank: i + 1,
								place_id: p.id,
								name: run.config.store_place_names ? p.name : null,
								// Phase 17 map pins: Places content, stored under the same switch as the names.
								address: run.config.store_place_names ? (p.address ?? null) : null,
								lat: run.config.store_place_names ? (p.lat ?? null) : null,
								lng: run.config.store_place_names ? (p.lng ?? null) : null,
								is_self: key === 'self',
								target_key: key ?? null,
							};
						}),
					});
				} catch (err) {
					if (!(err instanceof PlacesApiError)) throw err;
					apiCalls.pro += err.apiCalls;
					runErrors.push({ keyword, section: 'map', point: { lat: mp.lat, lng: mp.lng }, message: err.message });
					mapList.push({ keyword, point: mp.label, results: [] });
				}
			}
		}

		// 4. Metrics and change vs the previous comparable run (same keywords_version).
		const previous: PreviousRun = await RankRun.findOne({
			location_id: run.location_id,
			_id: { $ne: run._id },
			status: { $in: ['done', 'partial'] },
			keywords_version: run.keywords_version,
			run_at: { $lt: run.run_at },
		})
			.sort({ run_at: -1 })
			.select({ tracker: 1, overall: 1 })
			.lean<PreviousRun>();

		const keys = run.targets.map((t) => t.key);
		const tracker: TrackerSectionDoc[] = [];
		const grid: GridSectionDoc[] = [];
		for (const { keyword, tracker: tRanks, grid: gRanks } of ranked) {
			const trackerSummary: Record<string, TrackerSummaryDoc> = {};
			const gridSummary: Record<string, SummaryDoc> = {};
			for (const key of keys) {
				const current = summarise(cellsFor(tRanks, key));
				const { change, changeLabel } = keywordChange(previousSummary(previous, keyword, key), current);
				trackerSummary[key] = { ...current, change, changeLabel };
				gridSummary[key] = summarise(cellsFor(gRanks, key));
			}
			tracker.push({
				keyword,
				cells: tRanks.map((r) => ({
					point: { label: r.point.label, lat: r.point.lat, lng: r.point.lng },
					byTarget: r.byTarget,
					top3: r.top3,
					result_count: r.resultCount,
					more_results: r.moreResults,
				})),
				summary: trackerSummary,
			});
			grid.push({
				keyword,
				size: run.config.grid_size,
				spacing_km: run.config.spacing_km,
				points: gRanks.map((r) => ({
					row: r.point.row,
					col: r.point.col,
					lat: r.point.lat,
					lng: r.point.lng,
					byTarget: r.byTarget,
					top3: r.top3,
					result_count: r.resultCount,
					more_results: r.moreResults,
				})),
				summary: gridSummary,
			});
		}
		const overall: Record<string, OverallDoc> = {};
		for (const key of keys) {
			const current = overallAvgRank(tracker.map((t) => t.summary[key].avgRank));
			overall[key] = { overallAvgRank: current, change: overallChange(previous?.overall?.[key]?.overallAvgRank, current) };
		}

		// 5. Status: failed only if every search failed; partial on any error.
		const everySearchFailed = stats.searches > 0 && stats.errors === stats.searches;
		const status: RankRunStatus = everySearchFailed ? 'failed' : runErrors.length > 0 ? 'partial' : 'done';
		await finish(
			run,
			status,
			clock(),
			{ center, center_source: centerSource, tracker, grid, mapList, overall, api_calls: apiCalls, run_errors: runErrors },
			everySearchFailed ? 'every search failed' : null,
		);
		logger.info(
			`rank-run ${runId}: ${status} keywords=${run.keywords.length} ids_only=${apiCalls.ids_only} pro=${apiCalls.pro} details=${apiCalls.details}`,
		);
		return { status, runId };
	} catch (err) {
		const message = (err as Error).message;
		runErrors.push({ keyword: null, section: 'run', point: null, message });
		await finish(run, 'failed', clock(), { api_calls: apiCalls, run_errors: runErrors }, message);
		logger.error(`rank-run ${runId}: failed: ${message}`);
		return { status: 'failed', runId };
	} finally {
		if (beat) clearInterval(beat);
	}
};
