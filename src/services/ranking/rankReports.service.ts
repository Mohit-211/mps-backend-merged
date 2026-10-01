import httpStatus from 'http-status';
import { Types } from 'mongoose';
import config from '../../configs/config';
import { PlacesConfigError } from '../../clients/placesClient';
import { LeanRankRun, RankCellDoc, RankRun } from '../../models/rankRun.model';
import { RankCell, bucket, displayRank, normaliseKeyword, radiusFromSpacing } from '../../ranking';
import { ApiError, apiErrorWithData } from '../../utils';
import { resolveNames } from './resolveNames';
import { ILocationKeywordGroup } from '../../models/location.model';
import { findGroup, summariseGroup } from './keywordGroups';
import { GOOGLE_ATTRIBUTION } from '../../constants/attribution';

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
	// Phase 12.5: each sample's value (61 = not found, null = failed) and their spread; absent on older runs.
	...(cell.samples ? { samples: cell.samples, spread: cell.spread ?? null } : {}),
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
		if (!run) throw apiErrorWithData(httpStatus.NOT_FOUND, 'Rank run not found', { reason: 'run_not_found' });
		if (!VIEWABLE.includes(run.status)) {
			throw apiErrorWithData(httpStatus.CONFLICT, `Rank run is ${run.status}; only done or partial runs have reports`, { reason: 'run_not_finished', status: run.status });
		}
		return run;
	}
	const latest = await RankRun.findOne({ location_id: locationId, status: { $in: VIEWABLE } })
		.sort({ run_at: -1 })
		.lean<LeanRun>();
	if (!latest) throw apiErrorWithData(httpStatus.NOT_FOUND, 'No completed run yet', { reason: 'no_completed_run' });
	return latest;
};

const pickKeyword = <T extends { keyword: string }>(sections: T[], keyword?: string): T[] => {
	if (!keyword) return sections;
	const wanted = normaliseKeyword(keyword);
	const found = sections.filter((s) => normaliseKeyword(s.keyword) === wanted);
	if (found.length === 0) throw apiErrorWithData(httpStatus.NOT_FOUND, `Keyword not in this run: "${keyword}"`, { reason: 'keyword_not_in_run' });
	return found;
};

/** Phase 17: the location's keyword groups and an optional ?group= filter. */
export interface GroupOptions {
	groups?: ILocationKeywordGroup[];
	groupId?: string;
}

const inGroup = <T extends { keyword: string }>(sections: T[], group: ILocationKeywordGroup | null): T[] => {
	if (!group) return sections;
	const wanted = new Set(group.keywords);
	return sections.filter((s) => wanted.has(normaliseKeyword(s.keyword)));
};

export const rankTrackerView = async (locationId: Types.ObjectId | string, runId?: string, options: GroupOptions = {}) => {
	const groups = options.groups ?? [];
	const group = findGroup(groups, options.groupId);
	const run = await resolveViewRun(locationId, runId);
	const keys = run.targets.map((t) => t.key);
	const trendRuns = await RankRun.find({ location_id: locationId, status: { $in: VIEWABLE }, run_at: { $lte: run.run_at } })
		.sort({ run_at: -1 })
		.limit(TREND_RUNS)
		.select({ run_at: 1, overall: 1, keywords_version: 1 })
		.lean<Pick<LeanRun, '_id' | 'run_at' | 'overall' | 'keywords_version'>[]>();
	return {
		run: runMeta(run),
		targets: run.targets,
		group: group ? { group_id: String(group._id), name: group.name } : null,
		keywords: inGroup(run.tracker, group).map((section) => ({
			keyword: section.keyword,
			summary: section.summary,
			cells: section.cells.map((c) => ({ point: c.point, byTarget: byTargetView(c.byTarget) })),
		})),
		overall: run.overall,
		// Phase 17: every group's summary for this run (means over its keywords the run measured).
		groups: groups.map((g) => ({
			group_id: String(g._id),
			name: g.name,
			keywords: run.tracker.filter((t) => g.keywords.includes(normaliseKeyword(t.keyword))).map((t) => t.keyword),
			...summariseGroup(run.tracker, g.keywords, keys),
		})),
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

export const gridView = async (locationId: Types.ObjectId | string, keyword?: string, runId?: string, options: GroupOptions = {}) => {
	const group = findGroup(options.groups ?? [], options.groupId);
	const run = await resolveViewRun(locationId, runId);
	return {
		run: runMeta(run),
		targets: run.targets,
		grid: {
			size: run.config.grid_size,
			spacing_km: run.config.spacing_km,
			radius_km: run.config.radius_km ?? radiusFromSpacing(run.config.grid_size, run.config.spacing_km),
		},
		group: group ? { group_id: String(group._id), name: group.name } : null,
		keywords: pickKeyword(inGroup(run.grid, group), keyword).map((section) => ({
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
	pointParam?: string,
) => {
	const run = await resolveViewRun(locationId, runId);
	const point = !pointParam ? 'C' : pointParam === 'all' ? 'all' : pointParam.toUpperCase();
	const pointOf = (s: { point?: string }) => s.point ?? 'C';
	const available = [...new Set(run.mapList.map(pointOf))];
	if (point !== 'all' && !available.includes(point)) {
		throw apiErrorWithData(httpStatus.NOT_FOUND, `This run has no Map Ranking list at point ${point} (available: ${available.join(', ')})`, { reason: 'point_not_in_run', available });
	}
	const sections = pickKeyword(run.mapList, keyword).filter((s) => point === 'all' || pointOf(s) === point);
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
		point,
		points_available: available,
		keywords: sections.map((section) => ({
			keyword: section.keyword,
			point: pointOf(section),
			results: section.results.map((r) => ({ ...r, name: r.name ?? resolved?.[r.place_id] ?? null, address: r.address ?? null, lat: r.lat ?? null, lng: r.lng ?? null })),
		})),
		attribution: GOOGLE_ATTRIBUTION,
	};
};
