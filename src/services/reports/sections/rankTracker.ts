import { Types } from 'mongoose';
import { LeanRankRun, RankRun } from '../../../models';
import { RankTrackerData, RtKeywordRow } from '../types';

// Rank Tracker report data (Phase 12): copied from one stored RankRun (the self target) and the
// overall of the last runs. Pure builder + loader; no recomputation of ranks.

export const HISTORY_RUNS = 12;
const MOVERS = 5;

type Section = 'summary' | 'keywords' | 'history' | 'grid' | 'movers' | 'map_ranking';

const MAP_TOP = 5;
const POINT_ORDER = ['C', 'N', 'S', 'E', 'W'];

export type RunForReport = Pick<LeanRankRun, 'run_at' | 'finished_at' | 'status' | 'config' | 'tracker' | 'grid' | 'overall'> & Partial<Pick<LeanRankRun, 'mapList'>>;

const mean = (values: number[]): number | null => (values.length ? Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 100) / 100 : null);

export const buildRankTrackerData = (run: RunForReport, history: { run_at: Date; overall_avg_rank: number | null }[], sections: readonly string[]): RankTrackerData => {
	const want = (s: Section) => sections.includes(s);
	const keywords: RtKeywordRow[] = (run.tracker ?? []).map((t) => {
		const s = t.summary?.self;
		return {
			keyword: t.keyword,
			avg_rank: s?.avgRank ?? null,
			found_rate: s?.foundRate ?? null,
			top3_rate: s?.top3Rate ?? null,
			change: s?.change ?? null,
			label: s?.changeLabel ?? null,
		};
	});
	const data: RankTrackerData = {
		available: true,
		run: { run_at: run.run_at, finished_at: run.finished_at ?? null, partial: run.status === 'partial', grid_size: run.config?.grid_size ?? 0, spacing_km: run.config?.spacing_km ?? 0 },
	};
	if (want('summary')) {
		data.summary = {
			overall_avg_rank: run.overall?.self?.overallAvgRank ?? null,
			change: run.overall?.self?.change ?? null,
			top3_rate: mean(keywords.map((k) => k.top3_rate).filter((v): v is number => typeof v === 'number')),
			found_rate: mean(keywords.map((k) => k.found_rate).filter((v): v is number => typeof v === 'number')),
			keywords: keywords.length,
		};
	}
	if (want('keywords')) data.keywords = keywords;
	if (want('history')) data.history = history.slice(0, HISTORY_RUNS).reverse();
	if (want('grid')) {
		data.grid = (run.grid ?? []).map((g) => ({
			keyword: g.keyword,
			size: g.size,
			spacing_km: g.spacing_km,
			cells: g.points.map((p) => ({ row: p.row, col: p.col, rank: p.byTarget?.self?.rank ?? null, status: p.byTarget?.self?.status ?? 'error' })),
			avg_rank: g.summary?.self?.avgRank ?? null,
			found_rate: g.summary?.self?.foundRate ?? null,
			top3_rate: g.summary?.self?.top3Rate ?? null,
		}));
	}
	if (want('movers')) {
		const numeric = keywords.filter((k): k is RtKeywordRow & { change: number } => typeof k.change === 'number');
		data.movers = {
			improved: numeric.filter((k) => k.change > 0).sort((a, b) => b.change - a.change).slice(0, MOVERS).map((k) => ({ keyword: k.keyword, change: k.change })),
			declined: numeric.filter((k) => k.change < 0).sort((a, b) => a.change - b.change).slice(0, MOVERS).map((k) => ({ keyword: k.keyword, change: k.change })),
			entered: keywords.filter((k) => k.label === 'entered_top_60').map((k) => k.keyword),
			dropped: keywords.filter((k) => k.label === 'dropped_out_of_top_60').map((k) => k.keyword),
		};
	}
	if (want('map_ranking') && run.mapList?.length) {
		const byKeyword = new Map<string, NonNullable<RankTrackerData['map_ranking']>[number]>();
		for (const section of run.mapList) {
			const entry = byKeyword.get(section.keyword) ?? { keyword: section.keyword, points: [] };
			entry.points.push({
				point: section.point ?? 'C',
				top: section.results.slice(0, MAP_TOP).map((r) => ({ rank: r.rank, name: r.name, is_self: r.is_self })),
				self_rank: section.results.find((r) => r.is_self)?.rank ?? null,
			});
			byKeyword.set(section.keyword, entry);
		}
		data.map_ranking = [...byKeyword.values()].map((k) => ({ ...k, points: k.points.sort((a, b) => POINT_ORDER.indexOf(a.point) - POINT_ORDER.indexOf(b.point)) }));
	}
	return data;
};

/** The latest done/partial run of a location (or the given one), or null. */
export const findReportRun = (locationId: Types.ObjectId | string, runId?: Types.ObjectId | string | null) =>
	RankRun.findOne({ location_id: locationId, status: { $in: ['done', 'partial'] }, ...(runId ? { _id: runId } : {}) })
		.sort({ run_at: -1 })
		.select({ _id: 1, run_at: 1 })
		.lean<{ _id: Types.ObjectId; run_at: Date } | null>();

export const loadRankTrackerData = async (locationId: Types.ObjectId | string, runId: Types.ObjectId | string, sections: readonly string[]) => {
	const run = await RankRun.findOne({ _id: runId, location_id: locationId })
		.select({ run_at: 1, finished_at: 1, status: 1, config: 1, tracker: 1, grid: 1, overall: 1, mapList: 1 })
		.lean<RunForReport & { _id: Types.ObjectId }>();
	if (!run) return null;
	const history = await RankRun.find({ location_id: locationId, status: { $in: ['done', 'partial'] }, run_at: { $lte: run.run_at } })
		.sort({ run_at: -1 })
		.limit(HISTORY_RUNS)
		.select({ run_at: 1, 'overall.self': 1 })
		.lean<Pick<LeanRankRun, 'run_at' | 'overall'>[]>();
	return {
		run_id: String(run._id),
		data: buildRankTrackerData(
			run,
			history.map((h) => ({ run_at: h.run_at, overall_avg_rank: h.overall?.self?.overallAvgRank ?? null })),
			sections,
		),
	};
};
