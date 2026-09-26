import { Document, Model, Schema, Types, model } from 'mongoose';

// Per-user daily count of user-triggered (paid) Places calls: competitor suggestions and manual
// search (Phase 7a). Counted atomically in MongoDB so the cap holds across pm2 cluster processes.

export interface IPlacesUsage extends Document {
	user_id: Types.ObjectId;
	/** UTC day, "YYYY-MM-DD". */
	day: string;
	calls: number;
	expires_at: Date;
}

const PlacesUsageSchema = new Schema<IPlacesUsage>(
	{
		user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
		day: { type: String, required: true },
		calls: { type: Number, default: 0 },
		expires_at: { type: Date, required: true },
	},
	{ collection: 'places_usage' },
);

PlacesUsageSchema.index({ user_id: 1, day: 1 }, { unique: true });
PlacesUsageSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export const PlacesUsage: Model<IPlacesUsage> = model<IPlacesUsage>('PlacesUsage', PlacesUsageSchema);
