import { Document, Model, Schema, Types, model } from 'mongoose';

// Reports center (Phase 12): one generated report. The data is frozen in a ReportSnapshot and the PDF
// is rendered once from it, so a report never changes after generation. Files live in the private
// REPORTS_STORAGE_DIR; they are deleted after REPORT_RETENTION_MONTHS (status `expired`).

export const REPORT_TYPES = ['rank_tracker', 'gbp_audit', 'competitor_analysis', 'citation', 'reputation', 'full'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

/** The sections each type can contain (the default is all of them). A full report's sections are report types. */
export const REPORT_SECTIONS = {
	rank_tracker: ['summary', 'keywords', 'history', 'grid', 'movers', 'map_ranking', 'keyword_groups'],
	gbp_audit: ['score', 'checks', 'performance', 'keywords', 'profile', 'verification', 'pending_edits', 'reviews_media_posts'],
	competitor_analysis: ['public_scores', 'table', 'insights', 'reviews'],
	// Phase 16: the Citation Report (and the Citations part of the Full report).
	citation: ['score', 'table', 'nap_issues', 'changes'],
	// 2026-10-02: the Reputation Report (reviews; stored data only, never AI at generation).
	reputation: ['summary', 'distribution', 'needs_attention', 'replies_sent', 'insights'],
	full: ['rank_tracker', 'gbp_audit', 'competitor_analysis', 'citation', 'reputation'],
} as const satisfies Record<ReportType, readonly string[]>;

export type ReportSection<T extends ReportType> = (typeof REPORT_SECTIONS)[T][number];

export const REPORT_STATUSES = ['queued', 'generating', 'ready', 'failed', 'expired'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_RANGES = ['28d', '90d', '12m'] as const;
export type ReportRangeParam = (typeof REPORT_RANGES)[number];

export interface ReportPdfMeta {
	/** File name inside the organization's pdf directory (built from ids only). */
	file: string;
	bytes: number;
	pages: number;
	sha256: string;
}

export interface IReport extends Document {
	organization_id: Types.ObjectId;
	location_id: Types.ObjectId;
	/** The location's client when the report was created (a client_user sees reports of its clients). */
	client_id: Types.ObjectId | null;
	type: ReportType;
	sections: string[];
	/** run_at (Phase 17): when the report's rank run ran, for the library rows. */
	params: { run_id: Types.ObjectId | null; run_at?: Date | null; range: ReportRangeParam };
	status: ReportStatus;
	/** True while queued/generating: one active report per (location, type). */
	active: boolean;
	trigger: 'manual' | 'schedule';
	schedule_id: Types.ObjectId | null;
	pdf: ReportPdfMeta | null;
	failure_reason: string | null;
	created_by: Types.ObjectId;
	generated_at: Date | null;
	expires_at: Date | null;
	archived_at: Date | null;
	created_at: Date;
	updated_at: Date;
}

const ReportSchema = new Schema<IReport>(
	{
		organization_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
		location_id: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
		client_id: { type: Schema.Types.ObjectId, ref: 'Client', default: null },
		type: { type: String, enum: REPORT_TYPES, required: true },
		sections: { type: [String], default: [] },
		params: {
			run_id: { type: Schema.Types.ObjectId, ref: 'RankRun', default: null },
			run_at: { type: Date, default: null },
			range: { type: String, enum: REPORT_RANGES, default: '28d' },
		},
		status: { type: String, enum: REPORT_STATUSES, default: 'queued' },
		active: { type: Boolean, default: true },
		trigger: { type: String, enum: ['manual', 'schedule'], default: 'manual' },
		schedule_id: { type: Schema.Types.ObjectId, ref: 'ReportSchedule', default: null },
		pdf: {
			type: new Schema<ReportPdfMeta>({ file: String, bytes: Number, pages: Number, sha256: String }, { _id: false }),
			default: null,
		},
		failure_reason: { type: String, default: null },
		created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
		generated_at: { type: Date, default: null },
		expires_at: { type: Date, default: null },
		archived_at: { type: Date, default: null },
	},
	{ collection: 'reports', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);
ReportSchema.index({ location_id: 1, type: 1 }, { unique: true, partialFilterExpression: { active: true }, name: 'one_active_report_per_location_type' });
ReportSchema.index({ organization_id: 1, created_at: -1 });
ReportSchema.index({ organization_id: 1, location_id: 1, created_at: -1 });
ReportSchema.index({ expires_at: 1, status: 1 });

export const Report: Model<IReport> = model<IReport>('Report', ReportSchema);
