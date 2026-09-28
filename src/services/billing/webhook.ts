import { mapSubscription } from '../../clients/paypalClient';
import logger from '../../configs/logger';
import { BillingEvent, Invoice, IInvoice, Organization, PaymentOrder } from '../../models';
import { OrderService, orderService } from './orders';
import { SubscriptionService, subscriptionService } from './subscriptions';
import { credit } from './tokens';

// PayPal webhook handlers (Phase 13a). The route verifies the signature first (Phase 10); each event id
// is processed once (BillingEvent). If a handler throws, the event row is removed so PayPal's retry runs.

/* eslint-disable @typescript-eslint/no-explicit-any -- raw PayPal webhook payloads, mapped immediately */
type Raw = Record<string, any>;

export interface WebhookResult {
	handled: boolean;
	duplicate?: boolean;
	note?: string;
}

const num = (v: unknown): number => Number(v ?? 0) || 0;
const upId = (links: Raw[] | undefined, kind: string): string | null => {
	const href = links?.find((l) => l.rel === 'up')?.href as string | undefined;
	const m = href?.match(new RegExp(`/${kind}/([^/?]+)`));
	return m ? m[1] : null;
};

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

	const dispatch = async (type: string, r: Raw): Promise<WebhookResult> => {
		switch (type) {
			case 'BILLING.SUBSCRIPTION.CREATED':
			case 'BILLING.SUBSCRIPTION.ACTIVATED':
			case 'BILLING.SUBSCRIPTION.UPDATED':
			case 'BILLING.SUBSCRIPTION.EXPIRED':
			case 'BILLING.SUBSCRIPTION.CANCELLED':
			case 'BILLING.SUBSCRIPTION.SUSPENDED': {
				const ps = mapSubscription(r as never);
				const sub = await subs.findByProvider(ps.id, ps.custom_id);
				if (!sub) return { handled: false, note: 'unknown subscription' };
				await subs.applyPaypal(sub, ps);
				return { handled: true };
			}
			case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED': {
				const sub = await subs.findByProvider(r.id ?? null, r.custom_id ?? null);
				if (!sub) return { handled: false, note: 'unknown subscription' };
				await subs.paymentFailed(sub);
				return { handled: true };
			}
			case 'PAYMENT.SALE.COMPLETED': {
				const sub = await subs.findByProvider(r.billing_agreement_id ?? null, r.custom ?? null);
				if (!sub) return { handled: false, note: 'sale without a known subscription' };
				await subs.recordPayment(sub, { id: String(r.id), amount: num(r.amount?.total), currency: String(r.amount?.currency ?? sub.currency), time: r.create_time ? new Date(r.create_time) : now() });
				return { handled: true };
			}
			case 'PAYMENT.SALE.DENIED': {
				const sub = await subs.findByProvider(r.billing_agreement_id ?? null, r.custom ?? null);
				if (!sub) return { handled: false, note: 'sale without a known subscription' };
				await subs.paymentFailed(sub);
				return { handled: true };
			}
			case 'PAYMENT.SALE.REFUNDED':
			case 'PAYMENT.SALE.REVERSED':
				return { handled: true, note: await refundInvoice(r.sale_id ?? r.id ?? null, type === 'PAYMENT.SALE.REVERSED' ? 'reversed' : 'refunded') };
			case 'CHECKOUT.ORDER.APPROVED': {
				if (!r.id) return { handled: false, note: 'no order id' };
				const known = await PaymentOrder.exists({ provider_order_id: r.id });
				if (!known) return { handled: false, note: 'unknown order' };
				const res = await orders.capture(null, String(r.id));
				return { handled: true, note: res.status };
			}
			case 'PAYMENT.CAPTURE.COMPLETED': {
				const orderId = r.supplementary_data?.related_ids?.order_id ?? upId(r.links, 'orders');
				if (!orderId) return { handled: false, note: 'no order id' };
				const done = await orders.captureCompleted(String(orderId), String(r.id), num(r.amount?.value));
				return { handled: true, note: done ? 'fulfilled' : 'already fulfilled or unknown' };
			}
			case 'PAYMENT.CAPTURE.DENIED': {
				const orderId = r.supplementary_data?.related_ids?.order_id ?? upId(r.links, 'orders');
				if (orderId) await orders.captureDenied(String(orderId));
				return { handled: true };
			}
			case 'PAYMENT.CAPTURE.PENDING':
				return { handled: true, note: 'pending: waiting for COMPLETED' };
			case 'PAYMENT.CAPTURE.REFUNDED':
				return { handled: true, note: await refundInvoice(upId(r.links, 'captures'), 'refunded') };
			default:
				return { handled: false, note: 'ignored event type' };
		}
	};

	/** Processes a verified event once. */
	const handle = async (event: Raw): Promise<WebhookResult> => {
		const id = String(event?.id ?? '');
		const type = String(event?.event_type ?? '');
		if (!id || !type) return { handled: false, note: 'malformed event' };
		const resource = (event.resource ?? {}) as Raw;
		try {
			await BillingEvent.create({ event_id: id, event_type: type, resource_id: resource.id ? String(resource.id) : null, received_at: now() });
		} catch (err) {
			if ((err as { code?: number }).code === 11000) return { handled: true, duplicate: true };
			throw err;
		}
		try {
			const result = await dispatch(type, resource);
			logger.info(`billing: webhook ${type} ${id}: ${result.handled ? 'handled' : 'skipped'}${result.note ? ` (${result.note})` : ''}`);
			return result;
		} catch (err) {
			await BillingEvent.deleteOne({ event_id: id });
			logger.error(`billing: webhook ${type} ${id} failed: ${(err as Error).message}`);
			throw err;
		}
	};

	return { handle };
};

export const webhookHandler = createWebhookHandler();
