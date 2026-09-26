import { Document, Model, Schema, Types, model } from 'mongoose';

// Stored GBP data (Phase 7b). Pages and the 7c report read these; nothing calls Google on a page view.

// ---- Daily performance metrics (Business Profile Performance API) ----

export interface IGbpMetricDaily extends Document {
	location_id: Types.ObjectId;
	/** Calendar date of the metric, "YYYY-MM-DD". */
	date: string;
	metric: string;
	value: number;
}

const GbpMetricDailySchema = new Schema<IGbpMetricDaily>(
	{
		location_id: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
		date: { type: String, required: true },
		metric: { type: String, required: true },
		value: { type: Number, required: true },
	},
	{ collection: 'gbp_metrics_daily' },
);
GbpMetricDailySchema.index({ location_id: 1, date: 1, metric: 1 }, { unique: true });

export const GbpMetricDaily: Model<IGbpMetricDaily> = model<IGbpMetricDaily>('GbpMetricDaily', GbpMetricDailySchema);

// ---- Monthly search keywords (value, or a threshold such as "< 15" kept as a threshold) ----

export interface IGbpKeywordMonthly extends Document {
	location_id: Types.ObjectId;
	/** "YYYY-MM". */
	month: string;
	keyword: string;
	/** Exact impressions, or null when Google only gives a threshold. */
	value: number | null;
	/** Google's "fewer than N" threshold, or null when an exact value is given. Never coerced to a value. */
	threshold: number | null;
}

const GbpKeywordMonthlySchema = new Schema<IGbpKeywordMonthly>(
	{
		location_id: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
		month: { type: String, required: true },
		keyword: { type: String, required: true },
		value: { type: Number, default: null },
		threshold: { type: Number, default: null },
	},
	{ collection: 'gbp_keywords_monthly' },
);
GbpKeywordMonthlySchema.index({ location_id: 1, month: 1, keyword: 1 }, { unique: true });

export const GbpKeywordMonthly: Model<IGbpKeywordMonthly> = model<IGbpKeywordMonthly>('GbpKeywordMonthly', GbpKeywordMonthlySchema);

// ---- Profile snapshot (Business Information + attributes + Google edits + verification + v4 summaries) ----

export interface GbpHoursPeriod {
	open_day: string | null;
	open_time: string | null;
	close_day: string | null;
	close_time: string | null;
}

export interface GbpProfileSummary {
	title: string | null;
	description: string | null;
	primary_category: string | null;
	additional_categories: string[];
	regular_hours: GbpHoursPeriod[];
	/** Special-hours dates ("YYYY-MM-DD"), open or closed. */
	special_hour_dates: string[];
	more_hours_types: string[];
	primary_phone: string | null;
	additional_phones: string[];
	website: string | null;
	service_area: { business_type: string | null; place_count: number; region_code: string | null };
	labels: string[];
	open_status: string | null;
	service_items: number;
	latlng: { latitude: number; longitude: number } | null;
	place_id: string | null;
	maps_uri: string | null;
	new_review_uri: string | null;
}

export interface IGbpProfileSnapshot extends Document {
	location_id: Types.ObjectId;
	sync_id: Types.ObjectId;
	taken_at: Date;
	is_latest: boolean;
	profile: GbpProfileSummary | null;
	/** The Business Information location as returned (the owner's own data), for 7c scoring. */
	raw_location: Record<string, unknown> | null;
	attributes: { name: string; value_type: string | null; values: unknown[] }[] | null;
	pending_google_edits: { has_pending: boolean; diff_fields: string[]; pending_fields: string[] } | null;
	verification: { has_voice_of_merchant: boolean; has_business_authority: boolean; state: string | null; guidance: string | null } | null;
	media: {
		owner_count: number;
		customer_count: number;
		latest_owner_upload: Date | null;
		owner_uploads_per_month: Record<string, number>;
	} | null;
	posts: { total: number; last_post_at: Date | null; last_30_days: number; last_90_days: number; per_month: Record<string, number> } | null;
	reviews_summary: { average_rating: number | null; total: number | null } | null;
}

const GbpProfileSnapshotSchema = new Schema<IGbpProfileSnapshot>(
	{
		location_id: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
		sync_id: { type: Schema.Types.ObjectId, ref: 'GbpSync', required: true },
		taken_at: { type: Date, required: true },
		is_latest: { type: Boolean, default: true },
		profile: { type: Schema.Types.Mixed, default: null },
		raw_location: { type: Schema.Types.Mixed, default: null },
		attributes: { type: Schema.Types.Mixed, default: null },
		pending_google_edits: { type: Schema.Types.Mixed, default: null },
		verification: { type: Schema.Types.Mixed, default: null },
		media: { type: Schema.Types.Mixed, default: null },
		posts: { type: Schema.Types.Mixed, default: null },
		reviews_summary: { type: Schema.Types.Mixed, default: null },
	},
	{ collection: 'gbp_profile_snapshots', minimize: false },
);
GbpProfileSnapshotSchema.index({ location_id: 1, taken_at: -1 });
GbpProfileSnapshotSchema.index({ location_id: 1, is_latest: 1 });

export const GbpProfileSnapshot: Model<IGbpProfileSnapshot> = model<IGbpProfileSnapshot>('GbpProfileSnapshot', GbpProfileSnapshotSchema);

// ---- Reviews (v4) ----

export interface IGbpReview extends Document {
	location_id: Types.ObjectId;
	/** Google resource name ".../reviews/ID": the upsert key. */
	review_name: string;
	rating: number | null;
	comment: string | null;
	create_time: Date | null;
	update_time: Date | null;
	reply: { comment: string; update_time: Date | null } | null;
	/** Display name only: no reviewer photo or profile URL is stored. */
	reviewer: { display_name: string | null; is_anonymous: boolean };
	synced_at: Date;
}

const GbpReviewSchema = new Schema<IGbpReview>(
	{
		location_id: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
		review_name: { type: String, required: true },
		rating: { type: Number, default: null },
		comment: { type: String, default: null },
		create_time: { type: Date, default: null },
		update_time: { type: Date, default: null },
		reply: { type: new Schema({ comment: String, update_time: Date }, { _id: false }), default: null },
		reviewer: {
			display_name: { type: String, default: null },
			is_anonymous: { type: Boolean, default: false },
		},
		synced_at: { type: Date, required: true },
	},
	{ collection: 'gbp_reviews' },
);
GbpReviewSchema.index({ review_name: 1 }, { unique: true });
GbpReviewSchema.index({ location_id: 1, create_time: -1 });

export const GbpReview: Model<IGbpReview> = model<IGbpReview>('GbpReview', GbpReviewSchema);
