import { Document, Model, Schema, model } from 'mongoose';

// Processed PayPal webhook events (Phase 13a): one row per event id, so retried deliveries are ignored.

export interface IBillingEvent extends Document {
	event_id: string;
	event_type: string;
	resource_id: string | null;
	received_at: Date;
}

const BillingEventSchema = new Schema<IBillingEvent>(
	{
		event_id: { type: String, required: true },
		event_type: { type: String, required: true },
		resource_id: { type: String, default: null },
		received_at: { type: Date, required: true },
	},
	{ collection: 'billing_events' },
);
BillingEventSchema.index({ event_id: 1 }, { unique: true });
BillingEventSchema.index({ received_at: 1 }, { expireAfterSeconds: 90 * 86_400 });

export const BillingEvent: Model<IBillingEvent> = model<IBillingEvent>('BillingEvent', BillingEventSchema);
