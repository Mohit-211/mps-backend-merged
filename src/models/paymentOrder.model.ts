import { Document, Model, Schema, Types, model } from 'mongoose';
import { CURRENCIES, Currency, ORDER_PURPOSES, ORDER_STATUSES, OrderPurpose, OrderStatus } from '../billing/constants';

// One-time PayPal orders (Phase 13a): token packs and prorated location slots. Captured exactly once
// (compare-and-set on status), whether the return page or the webhook gets there first.

export interface IPaymentOrder extends Document {
	_id: Types.ObjectId;
	organization_id: Types.ObjectId;
	purpose: OrderPurpose;
	provider_order_id: string | null;
	status: OrderStatus;
	amount: number;
	currency: Currency;
	payload: {
		pack_id?: Types.ObjectId | null;
		tokens?: number;
		coupon_id?: Types.ObjectId | null;
		quantity?: number;
		quote?: Record<string, unknown>;
	};
	provider_capture_id: string | null;
	invoice_id: Types.ObjectId | null;
	failure_reason: string | null;
	created_by: Types.ObjectId | null;
	captured_at: Date | null;
	created_at: Date;
	updated_at: Date;
}

const PaymentOrderSchema = new Schema<IPaymentOrder>(
	{
		organization_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
		purpose: { type: String, enum: ORDER_PURPOSES, required: true },
		provider_order_id: { type: String, default: null },
		status: { type: String, enum: ORDER_STATUSES, default: 'created' },
		amount: { type: Number, required: true },
		currency: { type: String, enum: CURRENCIES, required: true },
		payload: { type: Schema.Types.Mixed, default: {} },
		provider_capture_id: { type: String, default: null },
		invoice_id: { type: Schema.Types.ObjectId, ref: 'Invoice', default: null },
		failure_reason: { type: String, default: null },
		created_by: { type: Schema.Types.ObjectId, default: null },
		captured_at: { type: Date, default: null },
	},
	{ collection: 'payment_orders', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }, minimize: false },
);
PaymentOrderSchema.index({ provider_order_id: 1 }, { unique: true, partialFilterExpression: { provider_order_id: { $type: 'string' } } });
PaymentOrderSchema.index({ organization_id: 1, created_at: -1 });

export const PaymentOrder: Model<IPaymentOrder> = model<IPaymentOrder>('PaymentOrder', PaymentOrderSchema);
