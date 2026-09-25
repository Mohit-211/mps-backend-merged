import mongoose, { Document, Model, Schema } from 'mongoose';
import {
	addTimestamps,
	globalQueryFilters,
	toJSON,
} from '../configs/mongoPlugins';

export interface IPayment extends Document {
	user_id?: Schema.Types.ObjectId;

	plan_id: Schema.Types.ObjectId;

	coupon_id?: Schema.Types.ObjectId;

	// Razorpay
	razorpay_order_id?: string;
	razorpay_payment_id?: string;
	razorpay_subscription_id?: string;

	// PayPal
	paypal_subscription_id?: string;
	paypal_plan_id?: string;

	monthly_amount: number;

	setup_fee: number;

	amount: number;

	discount_amount: number;

	final_amount: number;

	subscription_start_date?: Date;

	customer_name?: string;

	customer_email?: string;

	customer_mobile?: string;

	coupon_code?: string;

	business_details?: {
	business_name?: string;
	website_url?: string;
	primary_business_location?: string;
	additional_locations?: string;
	industry_category?: string;
	company_size?: string;
	full_name?: string;
	business_email?: string;
	phone_number?: string;
};

	subscription_status?: string;

	status: string;

	is_active: boolean;

	created_at: Date;

	updated_at: Date;
}

interface IPaymentModel extends Model<IPayment> {}

const paymentSchema = new Schema<IPayment>(
	{
		user_id: {
			type: Schema.Types.ObjectId,
			ref: 'User',
			default: null,
		},

		plan_id: {
			type: Schema.Types.ObjectId,
			ref: 'SubscriptionPlan',
			required: true,
		},

		coupon_id: {
			type: Schema.Types.ObjectId,
			ref: 'Coupon',
			default: null,
		},

		// ---------------- Razorpay ----------------

		razorpay_order_id: {
			type: String,
			default: null,
		},

		razorpay_payment_id: {
			type: String,
			default: null,
		},

		razorpay_subscription_id: {
			type: String,
			default: null,
		},

		// ---------------- PayPal ----------------

		paypal_subscription_id: {
			type: String,
			default: null,
		},

		paypal_plan_id: {
			type: String,
			default: null,
		},

		// ---------------- Amounts ----------------

		amount: {
			type: Number,
			required: true,
		},

		monthly_amount: {
			type: Number,
			required: true,
		},

		setup_fee: {
			type: Number,
			required: true,
		},

		discount_amount: {
			type: Number,
			default: 0,
		},

		final_amount: {
			type: Number,
			required: true,
		},

		// ---------------- Customer ----------------

		customer_name: {
			type: String,
			default: null,
		},

		customer_email: {
			type: String,
			default: null,
		},

		customer_mobile: {
			type: String,
			default: null,
		},

		coupon_code: {
			type: String,
			default: null,
		},

		business_details: {
			type: Object,
			default: null,
		},

		// ---------------- Subscription ----------------

		subscription_start_date: {
			type: Date,
			default: null,
		},

		subscription_status: {
			type: String,
			enum: [
				'created',
				'authenticated',
				'active',
				'pending',
				'halted',
				'cancelled',
				'completed',
				'expired',
			],
			default: 'created',
		},

		// ---------------- Payment Status ----------------

		status: {
			type: String,
			enum: [
				'PENDING',
				'SUCCESS',
				'FAILED',
				'CANCELLED',
				'PROCESSING_FAILED',
			],
			default: 'PENDING',
		},

		is_active: {
			type: Boolean,
			default: true,
		},
	},
	{
		collection: 'payments',
	},
);

paymentSchema.plugin(globalQueryFilters);
paymentSchema.plugin(toJSON);
paymentSchema.plugin(addTimestamps);

export const Payment = mongoose.model<IPayment, IPaymentModel>(
	'Payment',
	paymentSchema,
);
