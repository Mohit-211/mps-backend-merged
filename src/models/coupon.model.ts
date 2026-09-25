import mongoose, { Document, Model, Schema } from 'mongoose';
import {
	addTimestamps,
	globalQueryFilters,
	toJSON,
} from '../configs/mongoPlugins';

export interface ICoupon extends Document {
	code: string;

	plan_id: Schema.Types.ObjectId;

	original_amount: number;

	discount_amount: number;

	final_amount: number;

	expires_at: Date;

	used_by?: Schema.Types.ObjectId;

	is_used: boolean;

	is_active: boolean;
}

interface ICouponModel extends Model<ICoupon> { }

const couponSchema = new Schema<ICoupon>(
	{
		code: {
			type: String,
			required: true,
			unique: true,
		},
		plan_id: {
			type: Schema.Types.ObjectId,
			ref: 'SubscriptionPlan',
		},

		original_amount: {
			type: Number,
			required: true,
		},

		discount_amount: {
			type: Number,
			required: true,
		},

		final_amount: {
			type: Number,
			required: true,
		},
		expires_at: {
			type: Date,
			required: true,
		},
		used_by: {
			type: Schema.Types.ObjectId,
			ref: 'User',
			default: null,
		},
		is_used: {
			type: Boolean,
			default: false,
		},
		is_active: {
			type: Boolean,
			default: true,
		},
	},
	{
		collection: 'coupons',
	},
);

couponSchema.plugin(globalQueryFilters);
couponSchema.plugin(toJSON);
couponSchema.plugin(addTimestamps);

export const Coupon =
	mongoose.model<ICoupon, ICouponModel>(
		'Coupon',
		couponSchema,
	);