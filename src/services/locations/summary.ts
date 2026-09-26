import { Types } from 'mongoose';
import { GbpReportData, ILocationSummary, Location, RankRun } from '../../models';

// Location.summary (Phase 8): the latest numbers the locations list sorts and filters on, written after
// each rank run and each GBP report (so the list is one indexed query, not a join per row).

type Id = Types.ObjectId | string;

const setSummary = (locationId: Id, fields: Partial<ILocationSummary>) =>
	Location.updateOne({ _id: locationId }, { $set: Object.fromEntries(Object.entries(fields).map(([k, v]) => [`summary.${k}`, v])) });

/** From the latest done/partial rank run of the location. */
export const updateSummaryFromRuns = async (locationId: Id): Promise<void> => {
	const run = await RankRun.findOne({ location_id: locationId, status: { $in: ['done', 'partial'] } })
		.sort({ run_at: -1 })
		.select({ overall: 1, finished_at: 1, run_at: 1 })
		.lean<{ overall?: Record<string, { overallAvgRank: number | null; change: number | null }>; finished_at?: Date | null; run_at: Date }>();
	if (!run) return;
	await setSummary(locationId, {
		overall_avg_rank: run.overall?.self?.overallAvgRank ?? null,
		overall_change: run.overall?.self?.change ?? null,
		last_run_at: run.finished_at ?? run.run_at,
	});
};

/** From a generated GBP report: the GBP Score, the client's Public Score and its public rating/reviews. */
export const updateSummaryFromReport = async (locationId: Id, report: Pick<GbpReportData, 'gbp_score' | 'competitors' | 'reviews'>): Promise<void> => {
	const self = report.competitors.available ? report.competitors.rows.find((r) => r.is_self) : undefined;
	const reviews = report.reviews.available ? report.reviews : null;
	await setSummary(locationId, {
		gbp_score: report.gbp_score.available ? report.gbp_score.score : null,
		gbp_grade: report.gbp_score.available ? report.gbp_score.grade : null,
		gbp_partial: report.gbp_score.available ? report.gbp_score.partial : null,
		public_score: self?.public_score?.score ?? null,
		rating: reviews?.average_rating ?? self?.rating ?? null,
		review_count: reviews?.total ?? self?.user_rating_count ?? null,
	});
};
