import mongoose, { Document, Model, Schema } from 'mongoose';
import {
	addTimestamps,
	globalQueryFilters,
	toJSON,
} from '../configs/mongoPlugins';

export interface IUserSubscription extends Document {
	plan_id: mongoose.Types.ObjectId;

	paypal_subscription_id: string;

	paypal_plan_id: string;

	user_id?: mongoose.Types.ObjectId;

	payer_name?: string;

	payer_email?: string;

	status:
		| 'APPROVAL_PENDING'
		| 'ACTIVE'
		| 'SUSPENDED'
		| 'CANCELLED'
		| 'EXPIRED';

	next_billing_time?: Date;

	start_time?: Date;

	cancelled_at?: Date;

	coupon_id?: mongoose.Types.ObjectId;

	is_active: boolean;

	created_at: Date;
	updated_at: Date;
}

interface IUserSubscriptionModel extends Model<IUserSubscription> {}

const userSubscriptionSchema = new Schema<IUserSubscription>(
	{
		plan_id: {
			type: Schema.Types.ObjectId,
			ref: 'SubscriptionPlan',
			required: true,
		},

		paypal_subscription_id: {
			type: String,
			required: true,
			unique: true,
		},

		user_id: {
			type: Schema.Types.ObjectId,
			ref: 'User',
			default: null,
		},

		paypal_plan_id: {
			type: String,
			required: true,
		},

		payer_name: {
			type: String,
			default: null,
		},

		payer_email: {
			type: String,
			default: null,
		},

		status: {
			type: String,
			enum: [
				'APPROVAL_PENDING',
				'ACTIVE',
				'SUSPENDED',
				'CANCELLED',
				'EXPIRED',
			],
			default: 'APPROVAL_PENDING',
		},

		next_billing_time: {
			type: Date,
			default: null,
		},

		start_time: {
			type: Date,
			default: null,
		},

		cancelled_at: {
			type: Date,
			default: null,
		},

		coupon_id: {
			type: Schema.Types.ObjectId,
			ref: 'Coupon',
			default: null,
		},

		is_active: {
			type: Boolean,
			default: true,
		},
	},
	{
		collection: 'user_subscriptions',
	},
);

userSubscriptionSchema.plugin(globalQueryFilters);
userSubscriptionSchema.plugin(toJSON);
userSubscriptionSchema.plugin(addTimestamps);

export const UserSubscription = mongoose.model<
	IUserSubscription,
	IUserSubscriptionModel
>('UserSubscription', userSubscriptionSchema);
