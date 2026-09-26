import { Document, Model, Schema, Types, model } from 'mongoose';

// One GBP data sync of one location (Phase 7b). A sync fetches several data types independently;
// each records its own status so one failing type never hides the others. At most one queued or
// running sync per location (unique partial index on `active`), mirroring rank runs.

export const GBP_SYNC_TYPES = ['performance', 'keywords', 'profile', 'verification', 'reviews', 'media', 'posts'] as const;
export type GbpSyncType = (typeof GBP_SYNC_TYPES)[number];
export const V4_SYNC_TYPES: GbpSyncType[] = ['reviews', 'media', 'posts'];

export type GbpSyncStatus = 'queued' | 'running' | 'done' | 'partial' | 'failed';
export type GbpSyncTrigger = 'scheduled' | 'manual' | 'onboarding';
/** ok: stored; error: failed (message); not_available: v4 access pending; skipped: not attempted. */
export type GbpTypeStatus = 'pending' | 'ok' | 'error' | 'not_available' | 'skipped';

export interface GbpTypeResult {
	status: GbpTypeStatus;
	message: string | null;
	rows: number;
	range: { from: string; to: string } | null;
}

export interface IGbpSync extends Document {
	location_id: Types.ObjectId;
	created_by: Types.ObjectId;
	google_sub: string | null;
	gbp_location_id: string;
	gbp_account_id: string;
	trigger: GbpSyncTrigger;
	status: GbpSyncStatus;
	active: boolean;
	run_at: Date;
	started_at: Date | null;
	finished_at: Date | null;
	duration_ms: number | null;
	backfill: boolean;
	types: Record<GbpSyncType, GbpTypeResult>;
	api_calls: { total: number; by_endpoint: Record<string, number> };
	failure_reason: string | null;
	created_at: Date;
	updated_at: Date;
}

export type LeanGbpSync = Omit<IGbpSync, keyof Document> & { _id: Types.ObjectId };

const typeResultSchema = new Schema<GbpTypeResult>(
	{
		status: { type: String, enum: ['pending', 'ok', 'error', 'not_available', 'skipped'], default: 'pending' },
		message: { type: String, default: null },
		rows: { type: Number, default: 0 },
		range: { type: new Schema({ from: String, to: String }, { _id: false }), default: null },
	},
	{ _id: false },
);

const typesShape = Object.fromEntries(GBP_SYNC_TYPES.map((t) => [t, { type: typeResultSchema, default: () => ({}) }]));

const GbpSyncSchema = new Schema<IGbpSync>(
	{
		location_id: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
		created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
		google_sub: { type: String, default: null },
		gbp_location_id: { type: String, required: true },
		gbp_account_id: { type: String, required: true },
		trigger: { type: String, enum: ['scheduled', 'manual', 'onboarding'], required: true },
		status: { type: String, enum: ['queued', 'running', 'done', 'partial', 'failed'], default: 'queued' },
		active: { type: Boolean, default: true },
		run_at: { type: Date, required: true },
		started_at: { type: Date, default: null },
		finished_at: { type: Date, default: null },
		duration_ms: { type: Number, default: null },
		backfill: { type: Boolean, default: false },
		types: { type: new Schema(typesShape, { _id: false }), default: () => ({}) },
		api_calls: {
			total: { type: Number, default: 0 },
			by_endpoint: { type: Schema.Types.Mixed, default: {} },
		},
		failure_reason: { type: String, default: null },
		created_at: { type: Date, default: Date.now },
		updated_at: { type: Date, default: Date.now },
	},
	{ collection: 'gbp_syncs', minimize: false },
);

GbpSyncSchema.index({ location_id: 1, run_at: -1 });
GbpSyncSchema.index({ status: 1, started_at: 1 });
GbpSyncSchema.index({ location_id: 1 }, { unique: true, partialFilterExpression: { active: true }, name: 'one_active_sync_per_location' });

export const GbpSync: Model<IGbpSync> = model<IGbpSync>('GbpSync', GbpSyncSchema);
