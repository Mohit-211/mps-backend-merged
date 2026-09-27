import { Document, Model, Schema, Types, model } from 'mongoose';
import { REPORT_RANGES, REPORT_TYPES, ReportRangeParam, ReportType } from './report.model';

// Reports center (Phase 12): a monthly scheduled report for one location or for every location of a
// client (agency). It fires once per monthly automatic refresh cycle of each covered location, right
// after that location's GBP report is generated, and emails the PDF to the recipients.

export const SCHEDULE_SCOPES = ['location', 'client'] as const;
export type ScheduleScope = (typeof SCHEDULE_SCOPES)[number];
export const MAX_SCHEDULE_RECIPIENTS = 10;

export interface IReportSchedule extends Document {
	organization_id: Types.ObjectId;
	scope: ScheduleScope;
	location_id: Types.ObjectId | null;
	/** The client (client scope), or the location's client when it was created (location scope; used for client_user access). */
	client_id: Types.ObjectId | null;
	type: ReportType;
	sections: string[];
	range: ReportRangeParam;
	recipients: string[];
	frequency: 'monthly';
	status: 'active' | 'paused';
	last_sent_at: Date | null;
	last_error: string | null;
	last_report_id: Types.ObjectId | null;
	/** location id → the refresh.last_auto_refresh_at cycle already handled (one report per cycle). */
	cycles: Map<string, Date>;
	created_by: Types.ObjectId;
	created_at: Date;
	updated_at: Date;
}

const ReportScheduleSchema = new Schema<IReportSchedule>(
	{
		organization_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
		scope: { type: String, enum: SCHEDULE_SCOPES, required: true },
		location_id: { type: Schema.Types.ObjectId, ref: 'Location', default: null },
		client_id: { type: Schema.Types.ObjectId, ref: 'Client', default: null },
		type: { type: String, enum: REPORT_TYPES, required: true },
		sections: { type: [String], default: [] },
		range: { type: String, enum: REPORT_RANGES, default: '28d' },
		recipients: { type: [String], default: [] },
		frequency: { type: String, enum: ['monthly'], default: 'monthly' },
		status: { type: String, enum: ['active', 'paused'], default: 'active' },
		last_sent_at: { type: Date, default: null },
		last_error: { type: String, default: null },
		last_report_id: { type: Schema.Types.ObjectId, ref: 'Report', default: null },
		cycles: { type: Map, of: Date, default: {} },
		created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
	},
	{ collection: 'report_schedules', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);
ReportScheduleSchema.index({ organization_id: 1, status: 1, location_id: 1 });
ReportScheduleSchema.index({ organization_id: 1, status: 1, client_id: 1 });

export const ReportSchedule: Model<IReportSchedule> = model<IReportSchedule>('ReportSchedule', ReportScheduleSchema);
