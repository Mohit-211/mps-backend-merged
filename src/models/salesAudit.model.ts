import { Document, Model, Schema, Types, model } from 'mongoose';

// Sales audit (Phase 19): one short-lived audit run by a staff member (an Admin with audits.run).
// No history: DELETE removes it, and the TTL index deletes any audit left open past expires_at
// (STAFF_AUDIT_TTL_HOURS). Places content is kept only for that time.

export const SALES_AUDIT_STATUSES = ['queued', 'running', 'done', 'failed'] as const;
export type SalesAuditStatus = (typeof SALES_AUDIT_STATUSES)[number];

export interface ISalesAudit extends Document {
	created_by: Types.ObjectId;
	status: SalesAuditStatus;
	keyword: string;
	/** The business: place, center, region and its public facts (compute.ts PublicFacts) + quick score. */
	business: Record<string, unknown> & { place_id: string; lat: number; lng: number; region: 'us' | 'ca'; country: 'US' | 'CA' };
	grid: { size: number; radius_km: number; spacing_km: number };
	/** Filled when done (heatmap cells, summary, who ranks higher, competitor scores). */
	result: Record<string, unknown> | null;
	warnings: string[];
	api_calls: { ids_only: number; pro: number; details: number };
	failure_reason: string | null;
	started_at: Date | null;
	finished_at: Date | null;
	expires_at: Date;
	created_at: Date;
	updated_at: Date;
}

const SalesAuditSchema = new Schema<ISalesAudit>(
	{
		created_by: { type: Schema.Types.ObjectId, ref: 'Admin', required: true },
		status: { type: String, enum: SALES_AUDIT_STATUSES, default: 'queued' },
		keyword: { type: String, required: true },
		business: { type: Schema.Types.Mixed, required: true },
		grid: { type: Schema.Types.Mixed, required: true },
		result: { type: Schema.Types.Mixed, default: null },
		warnings: { type: [String], default: [] },
		api_calls: { type: Schema.Types.Mixed, default: () => ({ ids_only: 0, pro: 0, details: 0 }) },
		failure_reason: { type: String, default: null },
		started_at: { type: Date, default: null },
		finished_at: { type: Date, default: null },
		expires_at: { type: Date, required: true },
		/** Set by the service from its clock (the 10-minute stale check and expires_at use the same clock). */
		created_at: { type: Date, required: true },
	},
	{ collection: 'sales_audits', timestamps: { createdAt: false, updatedAt: 'updated_at' }, minimize: false },
);
SalesAuditSchema.index({ created_by: 1, created_at: -1 });
SalesAuditSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export const SalesAudit: Model<ISalesAudit> = model<ISalesAudit>('SalesAudit', SalesAuditSchema);
