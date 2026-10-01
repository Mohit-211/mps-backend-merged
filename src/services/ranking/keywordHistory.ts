import httpStatus from 'http-status';
import { Types } from 'mongoose';
import { ILocation } from '../../models/location.model';
import { LeanRankRun, RankRun } from '../../models/rankRun.model';
import { normaliseKeyword } from '../../ranking';
import { apiErrorWithData } from '../../utils';
import { withDefaults } from './trackingSettings';

// GET /locations/:id/keyword-history (Phase 17): one tracked keyword across the location's finished runs,
// for the per-keyword chart. Runs that didn't measure the keyword (before it was added) are skipped.
// Targets are listed per run because a competitor slot can hold another business in an older run.

export const DEFAULT_HISTORY_LIMIT = 12;
export const MAX_HISTORY_LIMIT = 24;
/** Runs scanned for the keyword (monthly runs: several years). */
const SCAN_RUNS = 120;

type HistoryRun = Pick<LeanRankRun, '_id' | 'run_at' | 'status' | 'keywords_version' | 'targets' | 'tracker'>;

export const keywordHistory = async (location: ILocation, keyword: string, limit = DEFAULT_HISTORY_LIMIT) => {
	const wanted = normaliseKeyword(keyword);
	const tracked = withDefaults(location.tracking).keywords.find((k) => k.normalized === wanted);
	if (!tracked) {
		throw apiErrorWithData(httpStatus.NOT_FOUND, `Keyword not tracked for this location: "${keyword}"`, { reason: 'keyword_not_tracked' });
	}
	const runs = await RankRun.find({ location_id: location._id as Types.ObjectId, status: { $in: ['done', 'partial'] } })
		.sort({ run_at: -1 })
		.limit(SCAN_RUNS)
		.select({ run_at: 1, status: 1, keywords_version: 1, targets: 1, 'tracker.keyword': 1, 'tracker.summary': 1 })
		.lean<HistoryRun[]>();
	const points = [];
	for (const run of runs) {
		const section = run.tracker.find((t) => normaliseKeyword(t.keyword) === wanted);
		if (!section) continue;
		points.push({
			run_id: String(run._id),
			run_at: run.run_at,
			status: run.status,
			keywords_version: run.keywords_version,
			targets: run.targets,
			summary: section.summary,
		});
		if (points.length >= limit) break;
	}
	return { keyword: tracked.text, runs: points.reverse() };
};
