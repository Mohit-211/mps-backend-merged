import { Document, Model, Schema, Types, model } from 'mongoose';

// Admin audit log (Phase 13a; 13b reuses it): who changed what, when, before → after.

export interface IAuditLog extends Document {
	_id: Types.ObjectId;
	actor: { admin_id: Types.ObjectId | null; name: string | null };
	organization_id: Types.ObjectId | null;
	action: string;
	target: string | null;
	before: unknown;
	after: unknown;
	note: string | null;
	at: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
	{
		actor: { admin_id: { type: Schema.Types.ObjectId, ref: 'Admin', default: null }, name: { type: String, default: null } },
		organization_id: { type: Schema.Types.ObjectId, ref: 'Organization', default: null },
		action: { type: String, required: true },
		target: { type: String, default: null },
		before: { type: Schema.Types.Mixed, default: null },
		after: { type: Schema.Types.Mixed, default: null },
		note: { type: String, default: null },
		at: { type: Date, required: true },
	},
	{ collection: 'audit_logs', minimize: false },
);
AuditLogSchema.index({ organization_id: 1, at: -1 });
AuditLogSchema.index({ at: -1 });
AuditLogSchema.index({ action: 1, at: -1 });

export const AuditLog: Model<IAuditLog> = model<IAuditLog>('AuditLog', AuditLogSchema);
