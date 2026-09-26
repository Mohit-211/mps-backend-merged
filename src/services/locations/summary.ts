import { Types } from 'mongoose';
import { GbpReportData, ILocation, ILocationSummary, Location, LocationMovement, RankRun } from '../../models';

// Location.summary (Phase 8, extended in Phase 11): the latest numbers the locations list and the
// dashboards read, written after each rank run and each GBP report. Page views read only this, never
// the full RankRun or report documents.

type Id = Types.ObjectId | string;

const TREND_RUNS = 6;
const MAX_DECLINES = 3;
const MAX_FIXES = 5;

const round = (value: number, decimals: number): number => {
	const f = 10 ** decimals;
	return Math.round((value + Number.EPSILON) * f) / f;
};

const setSummary = (locationId: Id, fields: Partial<ILocationSummary>) =>
	Location.updateOne({ _id: locationId }, { $set: Object.fromEntries(Object.entries(fields).map(([k, v]) => [`summary.${k}`, v])) });

// ---- From rank runs ----

interface SummaryCell {
	avgRank: number | null;
	top3Rate: number | null;
	change: number | null;
	changeLabel: string | null;
}

export interface RunForSummary {
	run_at: Date;
	finished_at?: Date | null;
	overall?: Record<string, { overallAvgRank: number | null; change: number | null }>;
	tracker?: { keyword: string; summary?: Record<string, SummaryCell> }[];
	targets?: { key: string; place_id: string }[];
	mapList?: { results: { place_id: string; name: string | null }[] }[];
}

const emptyMovement = (): LocationMovement => ({ improved: 0, declined: 0, unchanged: 0, entered_top_60: 0, dropped_out_of_top_60: 0, not_comparable: 0 });

/** The rank-derived summary fields (pure). `recent` is newest first and includes `latest`. */
export const runSummaryFields = (latest: RunForSummary, recent: RunForSummary[]): Partial<ILocationSummary> => {
	const selfRows = (latest.tracker ?? []).map((t) => ({ keyword: t.keyword, s: t.summary?.self })).filter((r): r is { keyword: string; s: SummaryCell } => Boolean(r.s));
	const top3 = selfRows.map((r) => r.s.top3Rate).filter((v): v is number => typeof v === 'number');

	const movement = emptyMovement();
	for (const { s } of selfRows) {
		const label = s.changeLabel as keyof LocationMovement | null;
		if (label && label in movement && label !== 'not_comparable') movement[label] += 1;
		else movement.not_comparable += 1;
	}
	const declines = selfRows
		.filter((r) => r.s.changeLabel === 'dropped_out_of_top_60' || r.s.changeLabel === 'declined')
		.sort((a, b) => {
			const drop = Number(b.s.changeLabel === 'dropped_out_of_top_60') - Number(a.s.changeLabel === 'dropped_out_of_top_60');
			return drop || (a.s.change ?? 0) - (b.s.change ?? 0);
		})
		.slice(0, MAX_DECLINES)
		.map((r) => ({ keyword: r.keyword, change: r.s.change, label: r.s.changeLabel as string }));

	const selfAvg = latest.overall?.self?.overallAvgRank ?? null;
	const names = new Map<string, string | null>();
	for (const section of latest.mapList ?? []) for (const r of section.results) if (r.name && !names.has(r.place_id)) names.set(r.place_id, r.name);
	const competitors = (latest.targets ?? [])
		.filter((t) => t.key !== 'self')
		.map((t) => ({ place_id: t.place_id, avg: latest.overall?.[t.key]?.overallAvgRank ?? null }))
		.filter((c): c is { place_id: string; avg: number } => typeof c.avg === 'number')
		.sort((a, b) => a.avg - b.avg);
	const best = competitors[0];

	return {
		overall_avg_rank: selfAvg,
		overall_change: latest.overall?.self?.change ?? null,
		last_run_at: latest.finished_at ?? latest.run_at,
		top3_rate: top3.length ? round(top3.reduce((s, v) => s + v, 0) / top3.length, 2) : null,
		rank_trend: recent
			.slice(0, TREND_RUNS)
			.reverse()
			.map((r) => ({ run_at: r.run_at, overall_avg_rank: r.overall?.self?.overallAvgRank ?? null })),
		movement,
		declines,
		key_competitor: best
			? { place_id: best.place_id, name: names.get(best.place_id) ?? null, avg_rank: best.avg, self_avg_rank: selfAvg, ahead: selfAvg === null || best.avg < selfAvg }
			: null,
	};
};

/** From the latest done/partial rank runs of the location. */
export const updateSummaryFromRuns = async (locationId: Id): Promise<void> => {
	const recent = await RankRun.find({ location_id: locationId, status: { $in: ['done', 'partial'] } })
		.sort({ run_at: -1 })
		.limit(TREND_RUNS)
		.select({ overall: 1, finished_at: 1, run_at: 1 })
		.lean<RunForSummary[]>();
	if (!recent.length) return;
	// Only the latest run's tracker summaries, targets and map-list names are needed (not the cells or grid).
	const latest = await RankRun.findById((recent[0] as unknown as { _id: Types.ObjectId })._id)
		.select({ overall: 1, finished_at: 1, run_at: 1, targets: 1, 'tracker.keyword': 1, 'tracker.summary': 1, 'mapList.results.place_id': 1, 'mapList.results.name': 1 })
		.lean<RunForSummary>();
	await setSummary(locationId, runSummaryFields(latest ?? recent[0], recent));
};

// ---- From the GBP report ----

export type ReportForSummary = Pick<GbpReportData, 'gbp_score' | 'competitors' | 'reviews'> &
	Partial<Pick<GbpReportData, 'verification' | 'pending_google_edits' | 'sync' | 'score_history'>>;

export const GBP_ISSUE_LABELS = {
	not_verified: 'The profile is not verified',
	pending_google_edits: 'Google has suggested edits waiting for review',
	sync_failed: 'The last GBP sync failed for some data',
	holiday_hours: 'Holiday hours are missing for upcoming holidays',
} as const;

/** The key competitor's name from the report's comparison rows (Place Details), if it is there. */
export const competitorNameFrom = (report: ReportForSummary, placeId: string | null): string | null => {
	if (!placeId || !report.competitors.available) return null;
	return report.competitors.rows.find((r) => r.place_id === placeId)?.name ?? null;
};

/** The report-derived summary fields (pure). */
export const reportSummaryFields = (report: ReportForSummary): Partial<ILocationSummary> => {
	const score = report.gbp_score.available ? report.gbp_score : null;
	const rows = report.competitors.available ? report.competitors.rows : [];
	const self = rows.find((r) => r.is_self);
	const reviews = report.reviews.available ? report.reviews : null;

	const history = report.score_history ?? [];
	const scored = history.filter((h) => typeof h.gbp_score === 'number');
	const change = score && scored.length >= 2 ? (scored[scored.length - 1].gbp_score as number) - (scored[scored.length - 2].gbp_score as number) : null;

	const lost = (fix: { pillar: string; max: number; points: number }): number => {
		const pillar = score?.pillars?.find((p) => p.id === fix.pillar);
		return pillar && pillar.available_max > 0 ? round(((fix.max - fix.points) / pillar.available_max) * pillar.weight, 1) : 0;
	};

	const issues: { id: keyof typeof GBP_ISSUE_LABELS; label: string }[] = [];
	const issue = (id: keyof typeof GBP_ISSUE_LABELS) => issues.push({ id, label: GBP_ISSUE_LABELS[id] });
	if (report.verification && report.verification.available && !report.verification.has_voice_of_merchant) issue('not_verified');
	if (report.pending_google_edits && report.pending_google_edits.available && report.pending_google_edits.has_pending) issue('pending_google_edits');
	if (report.sync && 'last_status' in report.sync && (report.sync.last_status === 'failed' || report.sync.last_status === 'partial')) issue('sync_failed');
	const holidays = score?.checks?.find((c) => c.id === 'special_hours');
	if (holidays && holidays.status === 'scored' && holidays.points < holidays.max) issue('holiday_hours');

	const fields: Partial<ILocationSummary> = {
		gbp_score: score ? score.score : null,
		gbp_grade: score ? score.grade : null,
		gbp_partial: score ? score.partial : null,
		gbp_score_change: change,
		top_fixes: (score?.top_fixes ?? []).slice(0, MAX_FIXES).map((f) => ({ id: f.id, pillar: f.pillar, label: f.label, fix_hint: f.fix_hint, lost: lost(f) })),
		gbp_issues: score ? issues : [],
		public_score: self?.public_score?.score ?? null,
		rating: reviews?.average_rating ?? self?.rating ?? null,
		review_count: reviews?.total ?? self?.user_rating_count ?? null,
		reviews_available: Boolean(reviews),
		unreplied: reviews ? reviews.unreplied.length : null,
	};
	return fields;
};

/** From a generated GBP report: the GBP Score, issues and fixes, the client's Public Score and rating. */
export const updateSummaryFromReport = async (locationId: Id, report: ReportForSummary): Promise<void> => {
	await setSummary(locationId, reportSummaryFields(report));
	const current = await Location.findById(locationId).select({ 'summary.key_competitor': 1 }).lean<Pick<ILocation, 'summary'>>();
	const name = competitorNameFrom(report, current?.summary?.key_competitor?.place_id ?? null);
	if (name) await Location.updateOne({ _id: locationId, 'summary.key_competitor': { $ne: null } }, { $set: { 'summary.key_competitor.name': name } });
};
