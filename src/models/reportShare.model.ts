import { Document, Model, Schema, Types, model } from 'mongoose';

// Reports center (Phase 12): a public share link to one report (/r/<token>). Only the SHA-256 of the
// 32-byte token is stored; the token is shown once, when the link is created. Optional expiry, revocable.

export interface IReportShare extends Document {
	report_id: Types.ObjectId;
	organization_id: Types.ObjectId;
	token_hash: string;
	expires_at: Date | null;
	revoked_at: Date | null;
	/** Why it was created: by a user, or automatically for an email whose PDF is too large to attach. */
	purpose: 'share' | 'email_link';
	created_by: Types.ObjectId | null;
	views: number;
	last_viewed_at: Date | null;
	created_at: Date;
	updated_at: Date;
}

const ReportShareSchema = new Schema<IReportShare>(
	{
		report_id: { type: Schema.Types.ObjectId, ref: 'Report', required: true },
		organization_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
		token_hash: { type: String, required: true },
		expires_at: { type: Date, default: null },
		revoked_at: { type: Date, default: null },
		purpose: { type: String, enum: ['share', 'email_link'], default: 'share' },
		created_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
		views: { type: Number, default: 0 },
		last_viewed_at: { type: Date, default: null },
	},
	{ collection: 'report_shares', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);
ReportShareSchema.index({ token_hash: 1 }, { unique: true });
ReportShareSchema.index({ report_id: 1, created_at: -1 });

export const ReportShare: Model<IReportShare> = model<IReportShare>('ReportShare', ReportShareSchema);
