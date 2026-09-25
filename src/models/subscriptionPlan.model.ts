import mongoose, { Document, Model, Schema } from 'mongoose';
import {
	addTimestamps,
	globalQueryFilters,
	toJSON,
} from '../configs/mongoPlugins';

export interface ISubscriptionPlan extends Document {
	name: string;
	description?: string;

	country: 'USA' | 'CANADA';
	currency: 'USD' | 'CAD';

	monthly_price: number;
	setup_fee: number;

	paypal_product_id?: string;
	paypal_plan_id?: string;

	is_active: boolean;

	created_at: Date;
	updated_at: Date;
}

interface ISubscriptionPlanModel extends Model<ISubscriptionPlan> {}

const subscriptionPlanSchema = new Schema<ISubscriptionPlan>(
	{
		name: {
			type: String,
			required: true,
			trim: true,
		},

		description: {
			type: String,
			default: null,
		},

		country: {
			type: String,
			required: true,
			enum: ['USA', 'CANADA'],
		},

		currency: {
			type: String,
			required: true,
			enum: ['USD', 'CAD'],
		},

		monthly_price: {
			type: Number,
			required: true,
			min: 0,
		},

		setup_fee: {
			type: Number,
			default: 0,
			min: 0,
		},

		paypal_product_id: {
			type: String,
			default: null,
		},

		paypal_plan_id: {
			type: String,
			default: null,
		},

		is_active: {
			type: Boolean,
			default: true,
		},
	},
	{
		collection: 'subscription_plans',
	},
);


subscriptionPlanSchema.plugin(globalQueryFilters);
subscriptionPlanSchema.plugin(toJSON);
subscriptionPlanSchema.plugin(addTimestamps);

export const SubscriptionPlan =
	mongoose.model<ISubscriptionPlan, ISubscriptionPlanModel>(
		'SubscriptionPlan',
		subscriptionPlanSchema,
	);