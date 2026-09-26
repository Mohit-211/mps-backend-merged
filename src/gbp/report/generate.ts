import { Types } from 'mongoose';
import config from '../../configs/config';
import logger from '../../configs/logger';
import { PlacesApiError, PlacesClient, PlacesConfigError, placesClient } from '../../clients/placesClient';
import { PlaceDetailsField } from '../../clients/types/places';
import {
	CompetitorsSection,
	GbpMetricDaily,
	GbpKeywordMonthly,
	GbpProfileSnapshot,
	GbpReport,
	GbpReportData,
	GbpReview,
	GbpSync,
	IGbpProfileSnapshot,
	IGbpReport,
	ILocation,
	Location,
	RankRun,
	ReportTrigger,
	ScoreHistoryEntry,
	Unavailable,
	UnavailableReason,
	UserGBP,
} from '../../models';
import { regionFromCountry } from '../../ranking/region';
import { withDefaults } from '../../services/ranking/trackingSettings';
import { COMPETITOR_DETAILS_FIELDS, SCORE_HISTORY_MAX } from '../scoring.config';
import { computeGbpScore } from '../score/gbpScore';
import { HolidayCountry } from '../score/holidays';
import { CompetitorRow, EMPTY_FACTS, MapListSection, competitorSet, factsFromDetails, needsFetch, scoreRow } from './competitors';
import { gapInsights } from './insights';
import { keywordsSection } from './keywords';
import { performanceSection, scorePerformance } from './performance';
import { ReviewInput, reviewStats, reviewsSection } from './reviews';

// GBP report generation (Phase 7c): reads only stored data (GBP sync output + the latest rank run),
// fetches Place Details for the competitor comparison under the freshness rule (competitors.ts),
// and overwrites the location's single report document. Runs in the gbp-report job.

export interface GenerateDeps {
	places?: Pick<PlacesClient, 'getPlaceDetails'>;
	now?: () => Date;
	v4Enabled?: boolean;
	withEditorialSummary?: boolean;
}

export interface GenerateResult {
	report_id: string;
	places_details: number;
}

const unavailable = (reason: UnavailableReason): Unavailable => ({ available: false, reason });

const countryOf = (location: ILocation): HolidayCountry | null => {
	try {
		return regionFromCountry(location.country) === 'us' ? 'US' : 'CA';
	} catch {
		return null;
	}
};

interface RunLean {
	_id: Types.ObjectId;
	overall?: Record<string, { overallAvgRank: number | null }>;
	tracker?: { summary?: Record<string, { top3Rate: number | null }> }[];
	mapList?: MapListSection[];
}

const ownRanking = (run: RunLean | null) => {
	if (!run) return null;
	const top3 = (run.tracker ?? []).map((t) => t.summary?.self?.top3Rate).filter((v): v is number => typeof v === 'number');
	return {
		overall_avg_rank: run.overall?.self?.overallAvgRank ?? null,
		top3_rate: top3.length ? Math.round((top3.reduce((s, v) => s + v, 0) / top3.length) * 100) / 100 : null,
	};
};

const detailsFields = (withEditorialSummary: boolean): PlaceDetailsField[] =>
	withEditorialSummary ? [...COMPETITOR_DETAILS_FIELDS, 'editorialSummary'] : [...COMPETITOR_DETAILS_FIELDS];

/** Competitor rows: fetch stale or missing Place Details, reuse the rest from the previous report. */
const buildCompetitors = async (
	location: ILocation,
	mapList: MapListSection[],
	previous: IGbpReport | null,
	places: Pick<PlacesClient, 'getPlaceDetails'>,
	now: Date,
	withEditorialSummary: boolean,
): Promise<{ section: CompetitorsSection | Unavailable; calls: number }> => {
	if (!location.place_id) return { section: unavailable('no_place_id'), calls: 0 };
	const refs = competitorSet(location.place_id, withDefaults(location.tracking).competitors, mapList);
	const previousRows = new Map<string, CompetitorRow>();
	const prevSection = previous?.competitors;
	if (prevSection && prevSection.available) for (const row of prevSection.rows) previousRows.set(row.place_id, row);
	const freshness = { now, cycle_start: location.refresh?.last_auto_refresh_at ?? null, force_at: location.gbp_report?.force_competitors_at ?? null };

	let calls = 0;
	let warning: UnavailableReason | null = null;
	const rows: CompetitorRow[] = [];
	for (const ref of refs) {
		const prev = previousRows.get(ref.place_id);
		const prevFetched = prev?.fetched_at ? new Date(prev.fetched_at) : null;
		const base = { place_id: ref.place_id, is_self: ref.source === 'self', source: ref.source };
		const reuse = (stale: boolean, error: string | null) => ({
			...base,
			...(prev ? pickFacts(prev) : EMPTY_FACTS),
			fetched_at: prevFetched,
			stale,
			error,
		});
		const due = needsFetch({ fetched_at: prevFetched }, freshness);
		if (!due) {
			rows.push(scoreRow(reuse(prev?.stale ?? false, prev?.error ?? null), mapList));
			continue;
		}
		if (warning === 'places_not_configured') {
			rows.push(scoreRow(reuse(true, null), mapList));
			continue;
		}
		try {
			const result = await places.getPlaceDetails(ref.place_id, detailsFields(withEditorialSummary));
			calls += result.apiCalls;
			rows.push(scoreRow({ ...base, ...factsFromDetails(result.details, withEditorialSummary), fetched_at: now, stale: false, error: null }, mapList));
		} catch (err) {
			if (err instanceof PlacesConfigError) {
				warning = 'places_not_configured';
				rows.push(scoreRow(reuse(true, null), mapList));
				continue;
			}
			if (err instanceof PlacesApiError) calls += err.apiCalls;
			const message = err instanceof Error ? err.message : String(err);
			logger.warn(`gbp-report: Place Details failed for a competitor of location ${String(location._id)}: ${message}`);
			rows.push(scoreRow(reuse(true, message), mapList));
		}
	}
	return { section: { available: true, generated_at: now, rows, insights: gapInsights(rows), warning }, calls };
};

const pickFacts = (row: CompetitorRow) => ({
	name: row.name,
	rating: row.rating,
	user_rating_count: row.user_rating_count,
	primary_type: row.primary_type,
	primary_type_label: row.primary_type_label,
	has_hours: row.has_hours,
	has_website: row.has_website,
	has_phone: row.has_phone,
	has_editorial_summary: row.has_editorial_summary,
	business_status: row.business_status,
});

/** Private (GBP-owner) sections: only for a bound location. */
const privateSections = async (location: ILocation, now: Date, v4: boolean, ranking: ReturnType<typeof ownRanking>) => {
	const locationId = location._id;
	const [snapshot, lastSync, metrics, keywordRows] = await Promise.all([
		GbpProfileSnapshot.findOne({ location_id: locationId, is_latest: true }).sort({ taken_at: -1 }).lean<IGbpProfileSnapshot>(),
		GbpSync.findOne({ location_id: locationId }).sort({ run_at: -1 }).lean(),
		GbpMetricDaily.find({ location_id: locationId }).select({ date: 1, metric: 1, value: 1, _id: 0 }).lean(),
		GbpKeywordMonthly.find({ location_id: locationId }).select({ month: 1, keyword: 1, value: 1, threshold: 1, _id: 0 }).lean(),
	]);
	const notSynced = unavailable('not_synced_yet');
	const v4Reason = (present: boolean): Unavailable => unavailable(v4 ? (present ? 'no_data' : 'not_synced_yet') : 'v4_access_pending');

	const performance = performanceSection(metrics);
	const keywords = keywordsSection(keywordRows, withDefaults(location.tracking).keywords.map((k) => k.text));

	let reviews: GbpReportData['reviews'] = v4Reason(false);
	let stats = null;
	if (v4 && snapshot?.reviews_summary) {
		const stored = await GbpReview.find({ location_id: locationId })
			.select({ rating: 1, comment: 1, create_time: 1, reply: 1, reviewer: 1, _id: 0 })
			.lean<ReviewInput[]>();
		reviews = reviewsSection(stored, now, snapshot.reviews_summary);
		stats = reviewStats(stored, now, snapshot.reviews_summary);
	}
	const media: GbpReportData['media'] = v4 && snapshot?.media ? { available: true, ...snapshot.media } : v4Reason(false);
	const posts: GbpReportData['posts'] = v4 && snapshot?.posts ? { available: true, ...snapshot.posts } : v4Reason(false);

	const gbpScore = snapshot || performance
		? computeGbpScore({
				now,
				country: countryOf(location),
				profile: snapshot?.profile ?? null,
				attributes_count: snapshot?.attributes ? snapshot.attributes.length : null,
				pending_google_edits: snapshot?.pending_google_edits ?? null,
				verification: snapshot?.verification ?? null,
				posts: v4 && snapshot?.posts ? snapshot.posts : null,
				media: v4 && snapshot?.media ? snapshot.media : null,
				reviews: stats,
				ranking,
				performance: scorePerformance(performance),
			})
		: notSynced;

	return {
		snapshot_id: snapshot ? String(snapshot._id) : null,
		sync_id: lastSync ? String(lastSync._id) : null,
		sections: {
			performance: performance ?? notSynced,
			keywords: keywords ?? notSynced,
			gbp_score: gbpScore,
			reviews,
			media,
			posts,
			pending_google_edits: snapshot?.pending_google_edits ? { available: true as const, ...snapshot.pending_google_edits } : notSynced,
			verification: snapshot?.verification
				? {
						available: true as const,
						has_voice_of_merchant: snapshot.verification.has_voice_of_merchant,
						has_business_authority: snapshot.verification.has_business_authority,
						state: snapshot.verification.state,
					}
				: notSynced,
			sync: lastSync
				? {
						last_synced_at: location.gbp_sync?.last_synced_at ?? null,
						last_status: lastSync.status,
						types: Object.fromEntries(Object.entries(lastSync.types ?? {}).map(([k, v]) => [k, { status: v.status, message: v.message }])),
					}
				: notSynced,
		},
	};
};

export const generateGbpReport = async (locationId: string, trigger: ReportTrigger, deps: GenerateDeps = {}): Promise<GenerateResult | null> => {
	const now = deps.now?.() ?? new Date();
	const v4 = deps.v4Enabled ?? config.gbp.v4Enabled;
	const withEditorialSummary = deps.withEditorialSummary ?? config.report.detailsAtmosphere;
	const location = await Location.findOne({ _id: locationId, is_active: true }).lean<ILocation>();
	if (!location) return null;

	const [binding, run, previous] = await Promise.all([
		UserGBP.exists({ location_id: location._id, is_active: true }),
		RankRun.findOne({ location_id: location._id, status: { $in: ['done', 'partial'] } }).sort({ run_at: -1 }).lean<RunLean>(),
		GbpReport.findOne({ location_id: location._id }).lean<IGbpReport>(),
	]);
	const bound = Boolean(binding);
	const ranking = ownRanking(run);
	const mapList = run?.mapList ?? [];

	const notConnected = unavailable('gbp_not_connected');
	const priv = bound ? await privateSections(location, now, v4, ranking) : null;
	const { section: competitors, calls } = await buildCompetitors(location, mapList, previous, deps.places ?? placesClient, now, withEditorialSummary);

	const gbpScore = priv ? priv.sections.gbp_score : notConnected;
	const selfRow = competitors.available ? competitors.rows.find((r) => r.is_self) : undefined;
	const historyEntry: ScoreHistoryEntry = {
		generated_at: now,
		gbp_score: gbpScore.available ? gbpScore.score : null,
		grade: gbpScore.available ? gbpScore.grade : null,
		public_score: selfRow?.public_score?.score ?? null,
	};
	const data: GbpReportData = {
		location_id: location._id as Types.ObjectId,
		generated_at: now,
		trigger,
		inputs: { rank_run_id: run ? String(run._id) : null, sync_id: priv?.sync_id ?? null, snapshot_id: priv?.snapshot_id ?? null },
		gbp_connected: bound,
		v4_enabled: v4,
		performance: priv?.sections.performance ?? notConnected,
		keywords: priv?.sections.keywords ?? notConnected,
		gbp_score: gbpScore,
		reviews: priv?.sections.reviews ?? notConnected,
		media: priv?.sections.media ?? notConnected,
		posts: priv?.sections.posts ?? notConnected,
		pending_google_edits: priv?.sections.pending_google_edits ?? notConnected,
		verification: priv?.sections.verification ?? notConnected,
		sync: priv?.sections.sync ?? notConnected,
		competitors,
		api_calls: { places_details: calls },
		score_history: [...(previous?.score_history ?? []), historyEntry].slice(-SCORE_HISTORY_MAX),
	};
	const saved = await GbpReport.findOneAndUpdate({ location_id: location._id }, { $set: data }, { upsert: true, new: true });
	const consumed = location.gbp_report?.force_competitors_at && location.gbp_report.force_competitors_at.getTime() <= now.getTime();
	await Location.updateOne(
		{ _id: location._id },
		{ $set: { 'gbp_report.last_generated_at': now, ...(consumed ? { 'gbp_report.force_competitors_at': null } : {}) } },
	);
	logger.info(
		`gbp-report: location ${String(location._id)} generated (${trigger}) bound=${bound} gbp_score=${historyEntry.gbp_score ?? '-'} places_details=${calls}`,
	);
	return { report_id: String(saved._id), places_details: calls };
};
