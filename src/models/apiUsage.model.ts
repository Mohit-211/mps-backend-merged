import { Document, Model, Schema, Types, model } from 'mongoose';

// Usage ledger (Phase 12.5): Google API calls per organization, location, month and billing SKU.
// Counts only (every HTTP attempt, retries included); prices are applied by `npm run cost:report`.
// organization_id / location_id are null for calls made outside any attributed scope. purpose marks
// platform work that belongs to no customer (Phase 19: 'sales_audit'); null = customer work.

export const USAGE_PURPOSES = ['sales_audit'] as const;
export type UsagePurpose = (typeof USAGE_PURPOSES)[number];

export interface IApiUsage extends Document {
	organization_id: Types.ObjectId | null;
	location_id: Types.ObjectId | null;
	purpose: UsagePurpose | null;
	/** "YYYY-MM" (UTC). */
	month: string;
	sku: string;
	count: number;
	updated_at: Date;
}

const ApiUsageSchema = new Schema<IApiUsage>(
	{
		organization_id: { type: Schema.Types.ObjectId, ref: 'Organization', default: null },
		location_id: { type: Schema.Types.ObjectId, ref: 'Location', default: null },
		purpose: { type: String, enum: [...USAGE_PURPOSES, null], default: null },
		month: { type: String, required: true },
		sku: { type: String, required: true },
		count: { type: Number, default: 0 },
		updated_at: { type: Date, default: null },
	},
	{ collection: 'api_usage' },
);
ApiUsageSchema.index({ organization_id: 1, location_id: 1, purpose: 1, month: 1, sku: 1 }, { unique: true });
ApiUsageSchema.index({ month: 1 });

export const ApiUsage: Model<IApiUsage> = model<IApiUsage>('ApiUsage', ApiUsageSchema);
