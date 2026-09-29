import logger from '../../configs/logger';
import { BillingEvent, Invoice, IInvoice, Organization, PaymentOrder } from '../../models';
import { OrderService, orderService } from './orders';
import { BillingWebhookEvent, ParsedWebhook } from './providers';
import { SubscriptionService, subscriptionService } from './subscriptions';
import { credit } from './tokens';

// Payment webhooks (Phase 13a; provider-neutral since 13b). The route verifies the signature with the
// provider and the provider parses the body; here each event id is processed once (BillingEvent). If a
// handler throws, the event row is removed so the provider's retry runs.

export interface WebhookResult {
	handled: boolean;
	duplicate?: boolean;
	note?: string;
}

export const createWebhookHandler = (deps: { subscriptions?: SubscriptionService; orders?: OrderService; now?: () => Date } = {}) => {
	const subs = deps.subscriptions ?? subscriptionService;
	const orders = deps.orders ?? orderService;
	const now = deps.now ?? (() => new Date());

	const refundInvoice = async (providerRef: string | null, note: string): Promise<string> => {
		if (!providerRef) return 'no reference';
		const inv = await Invoice.findOneAndUpdate({ provider_ref: providerRef, status: 'paid' }, { $set: { status: 'refunded', payment_note: note } }, { new: true }).lean<IInvoice>();
		if (!inv) return 'invoice not found or not paid';
		if (inv.kind === 'token_pack') {
			// Take the pack's tokens back, as far as the balance allows.
			const order = await PaymentOrder.findOne({ invoice_id: inv._id }).lean();
			const tokens = Number((order?.payload as { tokens?: number } | undefined)?.tokens ?? 0);
			const balance = (await Organization.findById(inv.organization_id).select({ token_balance: 1 }).lean<{ token_balance?: number }>())?.token_balance ?? 0;
			const take = Math.min(tokens, balance);
			if (take > 0) await credit(inv.organization_id, 'adjustment', -take, { ref: `refund:${providerRef}`, note: 'Token pack refunded' }, now());
		}
		return `invoice ${inv.number} refunded`;
	};

	const dispatch = async (e: BillingWebhookEvent): Promise<WebhookResult> => {
		switch (e.kind) {
			case 'subscription_updated': {
				const sub = await subs.findByProvider(e.subscription.id, e.subscription.customId);
				if (!sub) return { handled: false, note: 'unknown subscription' };
				await subs.applyProviderState(sub, e.subscription);
				return { handled: true };
			}
			case 'subscription_payment_failed': {
				const sub = await subs.findByProvider(e.providerSubscriptionId, e.customId);
				if (!sub) return { handled: false, note: 'unknown subscription' };
				await subs.paymentFailed(sub);
				return { handled: true };
			}
			case 'subscription_payment': {
				const sub = await subs.findByProvider(e.providerSubscriptionId, e.customId);
				if (!sub) return { handled: false, note: 'payment without a known subscription' };
				await subs.recordPayment(sub, { id: e.paymentId, amount: e.amount, currency: e.currency ?? sub.currency, time: e.paidAt ?? now() });
				return { handled: true };
			}
			case 'payment_refunded':
				return { handled: true, note: await refundInvoice(e.paymentRef, e.note) };
			case 'order_approved': {
				if (!(await PaymentOrder.exists({ provider_order_id: e.providerOrderId }))) return { handled: false, note: 'unknown order' };
				const res = await orders.capture(null, e.providerOrderId);
				return { handled: true, note: res.status };
			}
			case 'order_captured': {
				const done = await orders.captureCompleted(e.providerOrderId, e.captureId, e.amount);
				return { handled: true, note: done ? 'fulfilled' : 'already fulfilled or unknown' };
			}
			case 'order_capture_denied':
				await orders.captureDenied(e.providerOrderId);
				return { handled: true };
			case 'order_capture_pending':
				return { handled: true, note: 'pending: waiting for completion' };
			default:
				return { handled: false, note: 'ignored event type' };
		}
	};

	/** Processes a verified, parsed event once. */
	const handle = async (parsed: ParsedWebhook): Promise<WebhookResult> => {
		try {
			await BillingEvent.create({ event_id: parsed.eventId, event_type: parsed.type, resource_id: parsed.resourceId, received_at: now() });
		} catch (err) {
			if ((err as { code?: number }).code === 11000) return { handled: true, duplicate: true };
			throw err;
		}
		try {
			const result = await dispatch(parsed.event);
			logger.info(`billing: webhook ${parsed.type} ${parsed.eventId}: ${result.handled ? 'handled' : 'skipped'}${result.note ? ` (${result.note})` : ''}`);
			return result;
		} catch (err) {
			await BillingEvent.deleteOne({ event_id: parsed.eventId });
			logger.error(`billing: webhook ${parsed.type} ${parsed.eventId} failed: ${(err as Error).message}`);
			throw err;
		}
	};

	return { handle };
};

export const webhookHandler = createWebhookHandler();
