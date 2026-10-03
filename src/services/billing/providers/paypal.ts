import { IncomingHttpHeaders } from 'http';
import { PaypalClient, PaypalOrder, PaypalSubscription, mapSubscription, paypalClient } from '../../../clients/paypalClient';
import config from '../../../configs/config';
import logger from '../../../configs/logger';
import { Currency } from '../../../billing/constants';
import { BillingWebhookEvent, OrderNotApprovedError, PaymentProvider, ProviderOrder, ProviderSubscription, ProviderSubscriptionState } from './types';

// PayPal as a payment provider (Phases 13a / 13b). Everything PayPal-specific lives here: plan ids per
// currency, the per-subscription price override, the 10-day price-change rule (renewalLeadDays), Orders
// v2 capture quirks, webhook signature verification (Phase 10, AUDIT S4) and event parsing.

/* oxlint-disable typescript/no-explicit-any -- raw PayPal webhook payloads, mapped immediately */
type Raw = Record<string, any>;

const BRAND = 'MyPageSEO';

const stateOf = (raw: string): ProviderSubscriptionState => {
	switch (raw.toUpperCase()) {
		case 'APPROVAL_PENDING':
		case 'APPROVED':
			return 'approval_pending';
		case 'ACTIVE':
			return 'active';
		case 'SUSPENDED':
			return 'suspended';
		case 'CANCELLED':
			return 'cancelled';
		case 'EXPIRED':
			return 'expired';
		default:
			return 'unknown';
	}
};

export const toProviderSubscription = (ps: PaypalSubscription): ProviderSubscription => ({
	id: ps.id,
	state: stateOf(ps.status),
	customId: ps.custom_id,
	startTime: ps.start_time ? new Date(ps.start_time) : null,
	nextBillingTime: ps.next_billing_time ? new Date(ps.next_billing_time) : null,
	failedPayments: ps.failed_payments_count,
});

const toProviderOrder = (o: PaypalOrder): ProviderOrder => ({
	id: o.id,
	approveUrl: o.approve_url,
	capture: o.capture
		? { id: o.capture.id, state: o.capture.status === 'COMPLETED' ? 'completed' : o.capture.status === 'DECLINED' || o.capture.status === 'FAILED' ? 'declined' : 'pending', amount: o.capture.amount, currency: o.capture.currency }
		: null,
});

const num = (v: unknown): number => Number(v ?? 0) || 0;
const upId = (links: Raw[] | undefined, kind: string): string | null => {
	const href = links?.find((l) => l.rel === 'up')?.href as string | undefined;
	const m = href?.match(new RegExp(`/${kind}/([^/?]+)`));
	return m ? m[1] : null;
};

const header = (headers: IncomingHttpHeaders, name: string): string | null => {
	const v = headers[name];
	return typeof v === 'string' && v.length > 0 ? v : null;
};

/** PayPal event → billing event. */
export const parsePaypalEvent = (type: string, r: Raw): BillingWebhookEvent => {
	switch (type) {
		case 'BILLING.SUBSCRIPTION.CREATED':
		case 'BILLING.SUBSCRIPTION.ACTIVATED':
		case 'BILLING.SUBSCRIPTION.UPDATED':
		case 'BILLING.SUBSCRIPTION.EXPIRED':
		case 'BILLING.SUBSCRIPTION.CANCELLED':
		case 'BILLING.SUBSCRIPTION.SUSPENDED':
			return { kind: 'subscription_updated', subscription: toProviderSubscription(mapSubscription(r as never)) };
		case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED':
			return { kind: 'subscription_payment_failed', providerSubscriptionId: r.id ?? null, customId: r.custom_id ?? null };
		case 'PAYMENT.SALE.COMPLETED':
			return {
				kind: 'subscription_payment',
				providerSubscriptionId: r.billing_agreement_id ?? null,
				customId: r.custom ?? null,
				paymentId: String(r.id),
				amount: num(r.amount?.total),
				currency: r.amount?.currency ?? null,
				paidAt: r.create_time ? new Date(r.create_time) : null,
			};
		case 'PAYMENT.SALE.DENIED':
			return { kind: 'subscription_payment_failed', providerSubscriptionId: r.billing_agreement_id ?? null, customId: r.custom ?? null };
		case 'PAYMENT.SALE.REFUNDED':
		case 'PAYMENT.SALE.REVERSED':
			return { kind: 'payment_refunded', paymentRef: r.sale_id ?? r.id ?? null, note: type === 'PAYMENT.SALE.REVERSED' ? 'reversed' : 'refunded' };
		case 'CHECKOUT.ORDER.APPROVED':
			return r.id ? { kind: 'order_approved', providerOrderId: String(r.id) } : { kind: 'ignored' };
		case 'PAYMENT.CAPTURE.COMPLETED': {
			const orderId = r.supplementary_data?.related_ids?.order_id ?? upId(r.links, 'orders');
			return orderId ? { kind: 'order_captured', providerOrderId: String(orderId), captureId: String(r.id), amount: num(r.amount?.value) } : { kind: 'ignored' };
		}
		case 'PAYMENT.CAPTURE.DENIED': {
			const orderId = r.supplementary_data?.related_ids?.order_id ?? upId(r.links, 'orders');
			return orderId ? { kind: 'order_capture_denied', providerOrderId: String(orderId) } : { kind: 'ignored' };
		}
		case 'PAYMENT.CAPTURE.PENDING':
			return { kind: 'order_capture_pending', providerOrderId: r.supplementary_data?.related_ids?.order_id ?? null };
		case 'PAYMENT.CAPTURE.REFUNDED':
			return { kind: 'payment_refunded', paymentRef: upId(r.links, 'captures'), note: 'refunded' };
		default:
			return { kind: 'ignored' };
	}
};

export interface PaypalProviderDeps {
	client?: () => PaypalClient;
	webhookId?: string;
	renewalLeadDays?: number;
	planIds?: Partial<Record<Currency, string>>;
}

export const createPaypalProvider = (deps: PaypalProviderDeps = {}): PaymentProvider => {
	const client = deps.client ?? paypalClient;
	const planIds = () => deps.planIds ?? config.paypal.planIds;
	return {
		name: 'paypal',
		configured: () => client().configured(),
		canSubscribe: (currency) => client().configured() && Boolean(planIds()[currency]),
		// PayPal ignores price changes within 10 days of a charge (PayPal-funded subscriptions).
		renewalLeadDays: deps.renewalLeadDays ?? config.paypal.renewalLeadDays,

		startSubscription: async (input) => {
			const planId = planIds()[input.currency];
			if (!planId) throw new Error(`No PayPal plan for ${input.currency}`);
			const r = await client().createSubscription({
				plan_id: planId,
				custom_id: input.subscriptionId,
				monthly: input.monthly,
				currency: input.currency,
				return_url: input.returnUrl,
				cancel_url: input.cancelUrl,
				brand_name: BRAND,
				request_id: `sub-${input.subscriptionId}`,
				start_time: input.startAt,
			});
			return { providerId: r.id, approveUrl: r.approve_url };
		},
		getSubscription: async (id) => toProviderSubscription(await client().getSubscription(id)),
		setRenewalAmount: (id, monthly, currency) => client().setSubscriptionPrice(id, monthly, currency),
		cancelSubscription: (id, reason) => client().cancelSubscription(id, reason),

		createOrder: async (input) => {
			const o = await client().createOrder({
				amount: input.amount,
				currency: input.currency,
				custom_id: input.orderId,
				description: input.description,
				return_url: input.returnUrl,
				cancel_url: input.cancelUrl,
				brand_name: BRAND,
				request_id: `order-${input.orderId}`,
			});
			return { providerId: o.id, approveUrl: o.approve_url };
		},
		captureOrder: async (providerOrderId, orderId) => {
			try {
				return toProviderOrder(await client().captureOrder(providerOrderId, `capture-${orderId}`));
			} catch (err) {
				const reason = (err as { reason?: string }).reason;
				// Captured already by the other path (return page vs webhook): read it back.
				if (reason === 'ORDER_ALREADY_CAPTURED') return toProviderOrder(await client().getOrder(providerOrderId));
				if (reason === 'ORDER_NOT_APPROVED') throw new OrderNotApprovedError();
				throw err;
			}
		},

		verifyWebhook: async (headers, body) => {
			const webhookId = deps.webhookId ?? config.paypal.webhookId;
			if (!webhookId) {
				logger.warn('paypal webhook refused: PAYPAL_WEBHOOK_ID is not set');
				return false;
			}
			const fields = {
				auth_algo: header(headers, 'paypal-auth-algo'),
				cert_url: header(headers, 'paypal-cert-url'),
				transmission_id: header(headers, 'paypal-transmission-id'),
				transmission_sig: header(headers, 'paypal-transmission-sig'),
				transmission_time: header(headers, 'paypal-transmission-time'),
			};
			if (Object.values(fields).some((v) => v === null) || !body || typeof body !== 'object') return false;
			try {
				return (await client().verifyWebhookSignature({ ...fields, webhook_id: webhookId, webhook_event: body })) === 'SUCCESS';
			} catch (err) {
				logger.warn(`paypal webhook verification call failed: ${(err as Error).message}`);
				return false;
			}
		},
		parseWebhook: (body) => {
			const e = body as Raw;
			const eventId = String(e?.id ?? '');
			const type = String(e?.event_type ?? '');
			if (!eventId || !type) return null;
			const resource = (e.resource ?? {}) as Raw;
			return { eventId, type, resourceId: resource.id ? String(resource.id) : null, event: parsePaypalEvent(type, resource) };
		},
	};
};
