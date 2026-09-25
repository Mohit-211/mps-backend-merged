import httpStatus from 'http-status';
import { Types } from 'mongoose';
import config from '../../configs/config';
import { PlacesConfigError } from '../../clients/placesClient';
import { LeanRankRun, RankCellDoc, RankRun } from '../../models/rankRun.model';
import { RankCell, bucket, displayRank, normaliseKeyword } from '../../ranking';
import { ApiError } from '../../utils';
import { resolveNames } from './resolveNames';

// Read-only views for the three ranking pages (CLAUDE.md §9.4). Everything comes from stored
// RankRuns: no third-party calls on a page view (except the opt-in resolveNames path).

type LeanRun = LeanRankRun;

const VIEWABLE = ['done', 'partial'];
const TREND_RUNS = 12;

export const cellView = (cell: RankCellDoc) => ({
	rank: cell.rank,
	status: cell.status,
	bucket: bucket(cell as RankCell),
	display: displayRank(cell as RankCell),
});

const byTargetView = (byTarget: Record<string, RankCellDoc>) =>
	Object.fromEntries(Object.entries(byTarget).map(([key, cell]) => [key, cellView(cell)]));

export const runMeta = (run: LeanRun) => ({
	run_id: String(run._id),
	run_at: run.run_at,
	status: run.status,
	keywords_version: run.keywords_version,
	center: run.center,
	config: run.config,
});

/** The run to show: ?runId (must be done|partial) or the latest done|partial run. */
export const resolveViewRun = async (locationId: Types.ObjectId | string, runId?: string): Promise<LeanRun> => {
	if (runId) {
		if (!Types.ObjectId.isValid(runId)) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid runId');
		const run = await RankRun.findOne({ _id: runId, location_id: locationId }).lean<LeanRun>();
		if (!run) throw new ApiError(httpStatus.NOT_FOUND, 'Rank run not found');
		if (!VIEWABLE.includes(run.status)) {
			throw new ApiError(httpStatus.CONFLICT, `Rank run is ${run.status}; only done or partial runs have reports`);
		}
		return run;
	}
	const latest = await RankRun.findOne({ location_id: locationId, status: { $in: VIEWABLE } })
		.sort({ run_at: -1 })
		.lean<LeanRun>();
	if (!latest) throw new ApiError(httpStatus.NOT_FOUND, 'No completed run yet');
	return latest;
};

const pickKeyword = <T extends { keyword: string }>(sections: T[], keyword?: string): T[] => {
	if (!keyword) return sections;
	const wanted = normaliseKeyword(keyword);
	const found = sections.filter((s) => normaliseKeyword(s.keyword) === wanted);
	if (found.length === 0) throw new ApiError(httpStatus.NOT_FOUND, `Keyword not in this run: "${keyword}"`);
	return found;
};

export const rankTrackerView = async (locationId: Types.ObjectId | string, runId?: string) => {
	const run = await resolveViewRun(locationId, runId);
	const trendRuns = await RankRun.find({ location_id: locationId, status: { $in: VIEWABLE }, run_at: { $lte: run.run_at } })
		.sort({ run_at: -1 })
		.limit(TREND_RUNS)
		.select({ run_at: 1, overall: 1, keywords_version: 1 })
		.lean<Pick<LeanRun, '_id' | 'run_at' | 'overall' | 'keywords_version'>[]>();
	return {
		run: runMeta(run),
		targets: run.targets,
		keywords: run.tracker.map((section) => ({
			keyword: section.keyword,
			summary: section.summary,
			cells: section.cells.map((c) => ({ point: c.point, byTarget: byTargetView(c.byTarget) })),
		})),
		overall: run.overall,
		trend: trendRuns
			.reverse()
			.map((r) => ({
				run_id: String(r._id),
				run_at: r.run_at,
				overallAvgRank: r.overall?.self?.overallAvgRank ?? null,
				keywords_version: r.keywords_version,
			})),
	};
};

export const gridView = async (locationId: Types.ObjectId | string, keyword?: string, runId?: string) => {
	const run = await resolveViewRun(locationId, runId);
	return {
		run: runMeta(run),
		targets: run.targets,
		grid: { size: run.config.grid_size, spacing_km: run.config.spacing_km },
		keywords: pickKeyword(run.grid, keyword).map((section) => ({
			keyword: section.keyword,
			summary: section.summary,
			points: section.points.map((p) => ({ row: p.row, col: p.col, lat: p.lat, lng: p.lng, byTarget: byTargetView(p.byTarget) })),
		})),
	};
};

export const mapRankingView = async (
	locationId: Types.ObjectId | string,
	keyword?: string,
	runId?: string,
	resolveNamesRequested = false,
) => {
	const run = await resolveViewRun(locationId, runId);
	const sections = pickKeyword(run.mapList, keyword);
	const namesStored = run.config.store_place_names;
	let resolved: Record<string, string | null> | null = null;
	if (!namesStored && resolveNamesRequested && !config.ranking.storePlaceNames) {
		try {
			resolved = (await resolveNames(sections.flatMap((s) => s.results.map((r) => r.place_id)))).names;
		} catch (err) {
			if (err instanceof PlacesConfigError) {
				throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Names cannot be resolved: GOOGLE_PLACE_API_KEY not set');
			}
			throw err;
		}
	}
	return {
		run: runMeta(run),
		names_stored: namesStored,
		keywords: sections.map((section) => ({
			keyword: section.keyword,
			results: section.results.map((r) => ({ ...r, name: r.name ?? resolved?.[r.place_id] ?? null })),
		})),
	};
};
