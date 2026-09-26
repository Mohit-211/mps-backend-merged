import { Document, Model, Schema, model } from 'mongoose';

// Fixed-window request counters (Phase 8 auth endpoints). Stored in MongoDB so the limit holds across
// pm2 processes. The key is a hash (no emails or IPs in clear); windows expire via a TTL index.

export interface IRateLimit extends Document {
	key: string;
	count: number;
	window_ends_at: Date;
}

const RateLimitSchema = new Schema<IRateLimit>(
	{
		key: { type: String, required: true },
		count: { type: Number, default: 0 },
		window_ends_at: { type: Date, required: true },
	},
	{ collection: 'rate_limits' },
);
RateLimitSchema.index({ key: 1 }, { unique: true });
RateLimitSchema.index({ window_ends_at: 1 }, { expireAfterSeconds: 0 });

export const RateLimit: Model<IRateLimit> = model<IRateLimit>('RateLimit', RateLimitSchema);
