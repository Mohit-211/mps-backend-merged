import { Document, Model, Schema, Types, model } from 'mongoose';
import { CURRENCIES, Currency, FEATURES, Feature, PLAN_KINDS, PlanKind } from '../billing/constants';

// Billing plans (Phase 13a). One `standard` plan for everyone, and `custom` plans scoped to one
// organization (enterprise). Monthly = first_location_price + (n − 1) × additional_location_price.
// Prices are dated per currency: a renewal uses the price in effect at that renewal.

export interface PlanPrice {
	currency: Currency;
	first_location_price: number;
	additional_location_price: number;
	effective_from: Date;
	set_by: Types.ObjectId | null;
	set_at: Date;
}

export interface PlanTrial {
	days: number;
	locations: number;
	users: number;
	tokens: number;
}

export interface IBillingPlan extends Document {
	_id: Types.ObjectId;
	name: string;
	kind: PlanKind;
	organization_id: Types.ObjectId | null;
	entitlements: Record<Feature, boolean>;
	users_per_location: number;
	/** null = no cap (custom plans only). */
	max_locations: number | null;
	trial: PlanTrial;
	tokens_per_refresh: { rankings: number; gbp: number };
	monthly_token_grant: number;
	token_pack_discount_percent: number;
	/** Custom per-pack prices: { pack_id, currency, price }. */
	token_pack_prices: { pack_id: Types.ObjectId; currency: Currency; price: number }[];
	prices: PlanPrice[];
	is_active: boolean;
	created_at: Date;
	updated_at: Date;
}

const allFeatures = () => Object.fromEntries(FEATURES.map((f) => [f, true])) as Record<Feature, boolean>;

const BillingPlanSchema = new Schema<IBillingPlan>(
	{
		name: { type: String, required: true, trim: true },
		kind: { type: String, enum: PLAN_KINDS, required: true },
		organization_id: { type: Schema.Types.ObjectId, ref: 'Organization', default: null },
		entitlements: { type: Schema.Types.Mixed, default: allFeatures },
		users_per_location: { type: Number, min: 1, default: 3 },
		max_locations: { type: Number, min: 1, default: 20 },
		trial: {
			days: { type: Number, min: 0, default: 7 },
			locations: { type: Number, min: 0, default: 1 },
			users: { type: Number, min: 1, default: 3 },
			tokens: { type: Number, min: 0, default: 0 },
		},
		tokens_per_refresh: {
			rankings: { type: Number, min: 0, default: 1 },
			gbp: { type: Number, min: 0, default: 1 },
		},
		monthly_token_grant: { type: Number, min: 0, default: 0 },
		token_pack_discount_percent: { type: Number, min: 0, max: 100, default: 0 },
		token_pack_prices: {
			type: [{ pack_id: { type: Schema.Types.ObjectId, ref: 'TokenPack' }, currency: { type: String, enum: CURRENCIES }, price: { type: Number, min: 0 }, _id: false }],
			default: [],
		},
		prices: {
			type: [
				{
					currency: { type: String, enum: CURRENCIES, required: true },
					first_location_price: { type: Number, min: 0, required: true },
					additional_location_price: { type: Number, min: 0, required: true },
					effective_from: { type: Date, required: true },
					set_by: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
					set_at: { type: Date, default: () => new Date() },
					_id: false,
				},
			],
			default: [],
		},
		is_active: { type: Boolean, default: true },
	},
	{ collection: 'billing_plans', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }, minimize: false },
);
BillingPlanSchema.index({ kind: 1, is_active: 1 });
BillingPlanSchema.index({ organization_id: 1 }, { partialFilterExpression: { organization_id: { $type: 'objectId' } } });

export const BillingPlan: Model<IBillingPlan> = model<IBillingPlan>('BillingPlan', BillingPlanSchema);
