import { Document, Model, Schema, Types, model } from 'mongoose';
import { BILLING_METHODS, BillingMethod, CURRENCIES, Currency, SUBSCRIPTION_STATUSES, SubscriptionStatus } from '../billing/constants';

// An organization's subscription (Phase 13a): one open at a time (unique partial index). A PayPal
// subscription carries its own price override (fixed_price = first + (n − 1) × additional), patched
// by the renewal snapshot 11 days before each renewal (PayPal ignores changes within 10 days).

export interface SubscriptionPrice {
	first: number;
	additional: number;
}

export interface ISubscription extends Document {
	_id: Types.ObjectId;
	organization_id: Types.ObjectId;
	plan_id: Types.ObjectId;
	billing_method: BillingMethod;
	provider_subscription_id: string | null;
	currency: Currency;
	status: SubscriptionStatus;
	/** True while the subscription is not final (drives the one-open-per-organization index). */
	open: boolean;
	started_at: Date | null;
	current_period_start: Date | null;
	current_period_end: Date | null;
	paid_quantity: number;
	price: SubscriptionPrice;
	next_renewal: { period_end: Date; quantity: number; price: SubscriptionPrice; amount: number; fixed_at: Date } | null;
	cancel_at_period_end: boolean;
	cancelled_at: Date | null;
	past_due_since: Date | null;
	failed_payments: number;
	last_payment_at: Date | null;
	/** Manual billing / admin comp: free until this date (no invoices). */
	comp_until: Date | null;
	note: string | null;
	events: { at: Date; type: string; detail: string | null }[];
	created_by: Types.ObjectId | null;
	created_at: Date;
	updated_at: Date;
}

const PriceSchema = new Schema<SubscriptionPrice>({ first: { type: Number, default: 0 }, additional: { type: Number, default: 0 } }, { _id: false });

const SubscriptionSchema = new Schema<ISubscription>(
	{
		organization_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
		plan_id: { type: Schema.Types.ObjectId, ref: 'BillingPlan', required: true },
		billing_method: { type: String, enum: BILLING_METHODS, default: 'paypal' },
		provider_subscription_id: { type: String, default: null },
		currency: { type: String, enum: CURRENCIES, required: true },
		status: { type: String, enum: SUBSCRIPTION_STATUSES, default: 'approval_pending' },
		open: { type: Boolean, default: true },
		started_at: { type: Date, default: null },
		current_period_start: { type: Date, default: null },
		current_period_end: { type: Date, default: null },
		paid_quantity: { type: Number, min: 0, default: 1 },
		price: { type: PriceSchema, default: () => ({}) },
		next_renewal: {
			type: new Schema(
				{ period_end: Date, quantity: Number, price: PriceSchema, amount: Number, fixed_at: Date },
				{ _id: false },
			),
			default: null,
		},
		cancel_at_period_end: { type: Boolean, default: false },
		cancelled_at: { type: Date, default: null },
		past_due_since: { type: Date, default: null },
		failed_payments: { type: Number, default: 0 },
		last_payment_at: { type: Date, default: null },
		comp_until: { type: Date, default: null },
		note: { type: String, default: null },
		events: { type: [{ at: Date, type: { type: String }, detail: { type: String, default: null }, _id: false }], default: [] },
		created_by: { type: Schema.Types.ObjectId, default: null },
	},
	{ collection: 'subscriptions', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);
SubscriptionSchema.index({ organization_id: 1 }, { unique: true, partialFilterExpression: { open: true }, name: 'one_open_subscription_per_org' });
SubscriptionSchema.index({ provider_subscription_id: 1 }, { unique: true, partialFilterExpression: { provider_subscription_id: { $type: 'string' } } });
SubscriptionSchema.index({ status: 1, current_period_end: 1 });

export const Subscription: Model<ISubscription> = model<ISubscription>('Subscription', SubscriptionSchema);
