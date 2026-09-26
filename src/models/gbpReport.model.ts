import { Document, Model, Schema, Types, model } from 'mongoose';
import type { CompetitorRow } from '../gbp/report/competitors';
import type { Insight } from '../gbp/report/insights';
import type { KeywordsSection } from '../gbp/report/keywords';
import type { PerformanceSection } from '../gbp/report/performance';
import type { ReviewsSection } from '../gbp/report/reviews';
import type { GbpScoreResult } from '../gbp/score/gbpScore';

// The GBP report (Phase 7c): ONE document per location, overwritten on each generation, so Places
// content (the competitor comparison) is never kept historically. Only the client's own score
// numbers are kept as a short history. Generated in the gbp-report job; GET only reads it.

export const REPORT_TRIGGERS = ['gbp_sync', 'rank_run', 'competitors_changed', 'manual_refresh', 'unbind', 'seed'] as const;
export type ReportTrigger = (typeof REPORT_TRIGGERS)[number];

export type UnavailableReason = 'gbp_not_connected' | 'v4_access_pending' | 'not_synced_yet' | 'no_data' | 'places_not_configured' | 'no_place_id';

export interface Unavailable {
	available: false;
	reason: UnavailableReason;
}

export interface MediaSection {
	available: true;
	owner_count: number;
	customer_count: number;
	latest_owner_upload: Date | null;
	owner_uploads_per_month: Record<string, number>;
}

export interface PostsSection {
	available: true;
	total: number;
	last_post_at: Date | null;
	last_30_days: number;
	last_90_days: number;
	per_month: Record<string, number>;
}

export interface CompetitorsSection {
	available: true;
	generated_at: Date;
	rows: CompetitorRow[];
	insights: Insight[];
	/** Set when Place Details couldn't be fetched this time (stored rows are still shown). */
	warning: UnavailableReason | null;
}

export interface ScoreHistoryEntry {
	generated_at: Date;
	gbp_score: number | null;
	grade: string | null;
	public_score: number | null;
}

export interface GbpReportData {
	location_id: Types.ObjectId;
	generated_at: Date;
	trigger: ReportTrigger;
	inputs: { rank_run_id: string | null; sync_id: string | null; snapshot_id: string | null };
	gbp_connected: boolean;
	v4_enabled: boolean;
	performance: PerformanceSection | Unavailable;
	keywords: KeywordsSection | Unavailable;
	gbp_score: GbpScoreResult | Unavailable;
	reviews: ReviewsSection | Unavailable;
	media: MediaSection | Unavailable;
	posts: PostsSection | Unavailable;
	pending_google_edits: { available: true; has_pending: boolean; diff_fields: string[]; pending_fields: string[] } | Unavailable;
	verification: { available: true; has_voice_of_merchant: boolean; has_business_authority: boolean; state: string | null } | Unavailable;
	sync: { last_synced_at: Date | null; last_status: string | null; types: Record<string, { status: string; message: string | null }> } | Unavailable;
	competitors: CompetitorsSection | Unavailable;
	api_calls: { places_details: number };
	score_history: ScoreHistoryEntry[];
}

export interface IGbpReport extends Document, GbpReportData {}

const GbpReportSchema = new Schema<IGbpReport>(
	{
		location_id: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
		generated_at: { type: Date, required: true },
		trigger: { type: String, enum: REPORT_TRIGGERS, required: true },
		inputs: { type: Schema.Types.Mixed, default: {} },
		gbp_connected: { type: Boolean, default: false },
		v4_enabled: { type: Boolean, default: false },
		performance: { type: Schema.Types.Mixed, default: null },
		keywords: { type: Schema.Types.Mixed, default: null },
		gbp_score: { type: Schema.Types.Mixed, default: null },
		reviews: { type: Schema.Types.Mixed, default: null },
		media: { type: Schema.Types.Mixed, default: null },
		posts: { type: Schema.Types.Mixed, default: null },
		pending_google_edits: { type: Schema.Types.Mixed, default: null },
		verification: { type: Schema.Types.Mixed, default: null },
		sync: { type: Schema.Types.Mixed, default: null },
		competitors: { type: Schema.Types.Mixed, default: null },
		api_calls: { places_details: { type: Number, default: 0 } },
		score_history: { type: Schema.Types.Mixed, default: [] },
	},
	{ collection: 'gbp_reports', minimize: false },
);
GbpReportSchema.index({ location_id: 1 }, { unique: true });

export const GbpReport: Model<IGbpReport> = model<IGbpReport>('GbpReport', GbpReportSchema);
