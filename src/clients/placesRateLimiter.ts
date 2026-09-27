import mongoose, { Model, Schema, model } from 'mongoose';
import { Sleep, defaultSleep } from './http';

// Cluster-wide Places API limiter (Phase 12.5). Every pm2 process shares one counter document per
// second in MongoDB, so all processes together stay under PLACES_MAX_QPS (sized below Google's
// per-minute quota). A request that finds its second full waits for the next second.

export interface AsyncLimiter {
	acquire: () => Promise<void>;
}

interface IPlacesRate {
	_id: string;
	count: number;
	expires_at: Date;
}

const PlacesRateSchema = new Schema<IPlacesRate>(
	{ _id: { type: String }, count: { type: Number, default: 0 }, expires_at: { type: Date, required: true } },
	{ collection: 'places_rate', versionKey: false },
);
PlacesRateSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });
export const PlacesRate: Model<IPlacesRate> = model<IPlacesRate>('PlacesRate', PlacesRateSchema);

export interface MongoLimiterOptions {
	maxPerSecond: number;
	now?: () => number;
	sleep?: Sleep;
	/** Key prefix (tests use their own). */
	prefix?: string;
}

export const createMongoLimiter = (options: MongoLimiterOptions): AsyncLimiter => {
	const now = options.now ?? Date.now;
	const sleep = options.sleep ?? defaultSleep;
	const prefix = options.prefix ?? 'places';
	return {
		acquire: async () => {
			// Scripts that never connect to MongoDB (e.g. smoke:places) run unlimited rather than hang.
			if (mongoose.connection.readyState !== 1) return;
			for (;;) {
				const t = now();
				const second = Math.floor(t / 1000);
				const row = await PlacesRate.findOneAndUpdate(
					{ _id: `${prefix}:${second}` },
					{ $inc: { count: 1 }, $setOnInsert: { expires_at: new Date((second + 120) * 1000) } },
					{ upsert: true, new: true },
				).lean<IPlacesRate>();
				if (row && row.count <= options.maxPerSecond) return;
				await sleep((second + 1) * 1000 - t + Math.floor(Math.random() * 50));
			}
		},
	};
};

/** No limit (tests and scripts without a database). */
export const noLimiter: AsyncLimiter = { acquire: async () => undefined };
