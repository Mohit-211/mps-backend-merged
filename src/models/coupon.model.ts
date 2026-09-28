import { Document, Model, Schema, Types, model } from 'mongoose';

// Coupons (Phase 13a): token packs only (subscription discounts are custom plans). Percent or fixed,
// optionally limited to some packs, a number of redemptions and an expiry. Legacy per-plan coupons in
// the same collection are converted (or deactivated) by migrate:billing.

export const COUPON_DISCOUNT_TYPES = ['percent', 'fixed'] as const;
export type CouponDiscountType = (typeof COUPON_DISCOUNT_TYPES)[number];

export interface ICoupon extends Document {
	_id: Types.ObjectId;
	code: string;
	discount_type: CouponDiscountType;
	value: number;
	/** Empty = every pack. */
	pack_ids: Types.ObjectId[];
	max_redemptions: number | null;
	redemptions: number;
	expires_at: Date | null;
	is_active: boolean;
	note: string | null;
	created_at: Date;
	updated_at: Date;
}

const CouponSchema = new Schema<ICoupon>(
	{
		code: { type: String, required: true, trim: true, uppercase: true },
		discount_type: { type: String, enum: COUPON_DISCOUNT_TYPES, default: 'percent' },
		value: { type: Number, min: 0, default: 0 },
		pack_ids: { type: [{ type: Schema.Types.ObjectId, ref: 'TokenPack' }], default: [] },
		max_redemptions: { type: Number, min: 1, default: null },
		redemptions: { type: Number, min: 0, default: 0 },
		expires_at: { type: Date, default: null },
		is_active: { type: Boolean, default: true },
		note: { type: String, default: null },
	},
	{ collection: 'coupons', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);
CouponSchema.index({ code: 1 }, { unique: true });

export const Coupon: Model<ICoupon> = model<ICoupon>('Coupon', CouponSchema);
