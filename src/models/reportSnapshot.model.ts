import { Document, Model, Schema, Types, model } from 'mongoose';
import type { ReportType } from './report.model';

// Reports center (Phase 12): the frozen data of one report, written once at generation and never
// updated. The PDF and the share page are rendered from it, with the branding frozen here too.

export interface FrozenBranding {
	name: string;
	primary_color: string;
	secondary_color: string;
	footer_text: string | null;
	contact_text: string | null;
	/** "Powered by MyPageSEO" is hidden (agency white-label). */
	hide_mypageseo: boolean;
	/** The logo at generation time (PNG/JPEG, ≤ 512 KB), so later logo changes don't alter old reports. */
	logo: { mime: 'image/png' | 'image/jpeg'; data_base64: string } | null;
}

export interface SnapshotLocation {
	name: string;
	address: string | null;
	city: string | null;
	state: string | null;
	country: string | null;
	client_name: string | null;
}

export interface IReportSnapshot extends Document {
	report_id: Types.ObjectId;
	type: ReportType;
	location: SnapshotLocation;
	branding: FrozenBranding;
	/** Section data per report part (see services/reports/types.ts). */
	data: Record<string, unknown>;
	sources: { rank_run_id: string | null; gbp_report_generated_at: Date | null };
	created_at: Date;
}

const ReportSnapshotSchema = new Schema<IReportSnapshot>(
	{
		report_id: { type: Schema.Types.ObjectId, ref: 'Report', required: true },
		type: { type: String, required: true },
		location: { type: Schema.Types.Mixed, required: true },
		branding: { type: Schema.Types.Mixed, required: true },
		data: { type: Schema.Types.Mixed, default: {} },
		sources: { type: Schema.Types.Mixed, default: {} },
	},
	{ collection: 'report_snapshots', minimize: false, timestamps: { createdAt: 'created_at', updatedAt: false } },
);
ReportSnapshotSchema.index({ report_id: 1 }, { unique: true });

export const ReportSnapshot: Model<IReportSnapshot> = model<IReportSnapshot>('ReportSnapshot', ReportSnapshotSchema);
