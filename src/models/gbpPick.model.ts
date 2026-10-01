import { Document, Model, Schema, Types, model } from 'mongoose';

// A Business Profile location the user picked in the Google connect modal (2026-10-01, Mohit): only picked
// locations appear on the locations page. A pick is free; binding it (POST /gbp/picks/:pickId/bind, behind the
// subscription gate) creates or links our Location and binds the profile, and sets location_id. Picks belong
// to the user whose Google connection (google_sub) lists the profile; one pick per profile per organization.

export interface IGbpPick extends Document {
	organization_id: Types.ObjectId;
	user_id: Types.ObjectId;
	google_sub: string;
	gbpAccountId: string;
	gbpLocationId: string;
	/** Snapshot from Google when picked (display only; the bind reads the profile again). */
	title: string | null;
	address: string | null;
	city: string | null;
	region_code: string | null;
	place_id: string | null;
	picked_at: Date;
	/** Set when bound: the Location it created or linked. */
	location_id: Types.ObjectId | null;
	bound_at: Date | null;
}

const GbpPickSchema = new Schema<IGbpPick>(
	{
		organization_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
		user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
		google_sub: { type: String, required: true },
		gbpAccountId: { type: String, required: true },
		gbpLocationId: { type: String, required: true },
		title: { type: String, default: null },
		address: { type: String, default: null },
		city: { type: String, default: null },
		region_code: { type: String, default: null },
		place_id: { type: String, default: null },
		picked_at: { type: Date, required: true },
		location_id: { type: Schema.Types.ObjectId, ref: 'Location', default: null },
		bound_at: { type: Date, default: null },
	},
	{ collection: 'gbp_picks', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);
GbpPickSchema.index({ organization_id: 1, gbpLocationId: 1 }, { unique: true });
GbpPickSchema.index({ user_id: 1, google_sub: 1 });
GbpPickSchema.index({ location_id: 1 });

export const GbpPick: Model<IGbpPick> = model<IGbpPick>('GbpPick', GbpPickSchema);
