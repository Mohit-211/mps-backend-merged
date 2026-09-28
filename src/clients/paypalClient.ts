import config from '../configs/config';
import logger from '../configs/logger';
import { Currency } from '../billing/constants';
import { HttpRequestError, HttpTransport, createAxiosTransport, formBody, withRetry } from './http';

// PayPal REST client (Phase 13a): Catalog Products, Subscriptions v1 and Orders v2. Typed, mockable
// (pass a transport), an OAuth token cached until it expires, 15 s timeout, 1 retry on 429 / 5xx /
// timeouts, safe errors (status, PayPal name, issue, debug_id; never payloads or credentials).
//
// Mechanics (verified against PayPal's schemas on 2026-09-28, docs/plans/phase-13-billing-admin.md):
// - no PayPal quantity: `revise` needs the buyer's consent; each subscription carries its own price
//   override, changed with PATCH …/pricing_scheme/fixed_price (no consent; not within 10 days of a charge)
// - one-time charges (token packs, prorated slots) are Orders v2 payments: create → approve → capture

export class PaypalConfigError extends Error {
	constructor(message = 'PayPal is not configured (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET)') {
		super(message);
		this.name = 'PaypalConfigError';
	}
}

export interface PaypalLink {
	href: string;
	rel: string;
	method?: string;
}

export interface PaypalSubscription {
	id: string;
	status: string;
	plan_id: string | null;
	custom_id: string | null;
	start_time: string | null;
	next_billing_time: string | null;
	last_payment: { amount: number; currency: string; time: string } | null;
	failed_payments_count: number;
	subscriber_email: string | null;
}

export interface PaypalOrder {
	id: string;
	status: string;
	custom_id: string | null;
	approve_url: string | null;
	capture: { id: string; status: string; amount: number; currency: string } | null;
}

export interface PaypalClientDeps {
	transport?: HttpTransport;
	clientId?: string;
	clientSecret?: string;
	mode?: 'sandbox' | 'live';
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
}

const amount = (value: number, currency: Currency) => ({ currency_code: currency, value: value.toFixed(2) });
const linkOf = (links: PaypalLink[] | undefined, ...rels: string[]): string | null => links?.find((l) => rels.includes(l.rel))?.href ?? null;

interface RawSubscription {
	id: string;
	status: string;
	plan_id?: string;
	custom_id?: string;
	start_time?: string;
	subscriber?: { email_address?: string };
	billing_info?: {
		next_billing_time?: string;
		failed_payments_count?: number;
		last_payment?: { amount?: { currency_code: string; value: string }; time?: string };
	};
	links?: PaypalLink[];
}

interface RawOrder {
	id: string;
	status: string;
	links?: PaypalLink[];
	purchase_units?: {
		custom_id?: string;
		payments?: { captures?: { id: string; status: string; amount: { currency_code: string; value: string } }[] };
	}[];
}

export const mapSubscription = (r: RawSubscription): PaypalSubscription => ({
	id: r.id,
	status: r.status,
	plan_id: r.plan_id ?? null,
	custom_id: r.custom_id ?? null,
	start_time: r.start_time ?? null,
	next_billing_time: r.billing_info?.next_billing_time ?? null,
	last_payment:
		r.billing_info?.last_payment?.amount && r.billing_info.last_payment.time
			? { amount: Number(r.billing_info.last_payment.amount.value), currency: r.billing_info.last_payment.amount.currency_code, time: r.billing_info.last_payment.time }
			: null,
	failed_payments_count: r.billing_info?.failed_payments_count ?? 0,
	subscriber_email: r.subscriber?.email_address ?? null,
});

export const mapOrder = (r: RawOrder): PaypalOrder => {
	const unit = r.purchase_units?.[0];
	const c = unit?.payments?.captures?.[0];
	return {
		id: r.id,
		status: r.status,
		custom_id: unit?.custom_id ?? null,
		approve_url: linkOf(r.links, 'payer-action', 'approve'),
		capture: c ? { id: c.id, status: c.status, amount: Number(c.amount.value), currency: c.amount.currency_code } : null,
	};
};

export const createPaypalClient = (deps: PaypalClientDeps = {}) => {
	const transport = deps.transport ?? createAxiosTransport();
	const mode = deps.mode ?? config.paypal.mode;
	const base = mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
	const clientId = deps.clientId ?? config.paypal.clientId;
	const clientSecret = deps.clientSecret ?? config.paypal.clientSecret;
	const now = deps.now ?? (() => Date.now());
	let token: { value: string; expires: number } | null = null;
	let calls = 0;

	const configured = (): boolean => Boolean(clientId && clientSecret);

	const accessToken = async (): Promise<string> => {
		if (!configured()) throw new PaypalConfigError();
		if (token && token.expires > now() + 60_000) return token.value;
		const { value } = await withRetry(
			() =>
				transport<{ access_token: string; expires_in: number }>({
					method: 'POST',
					url: `${base}/v1/oauth2/token`,
					headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
					data: formBody({ grant_type: 'client_credentials' }),
				}),
			{ sleep: deps.sleep },
		);
		calls += 1;
		token = { value: value.data.access_token, expires: now() + value.data.expires_in * 1000 };
		return token.value;
	};

	const call = async <T>(method: 'GET' | 'POST' | 'PATCH', path: string, data?: unknown, extraHeaders: Record<string, string> = {}): Promise<T> => {
		const bearer = await accessToken();
		const started = now();
		try {
			const { value } = await withRetry(
				() =>
					transport<T>({
						method,
						url: `${base}${path}`,
						headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...extraHeaders },
						data,
					}),
				{ sleep: deps.sleep },
			);
			calls += 1;
			logger.info(`paypal ${method} ${path.replace(/\/[A-Z0-9-]{10,}/g, '/:id')} ok ${now() - started}ms`);
			return value.data;
		} catch (err) {
			const e = err as HttpRequestError;
			logger.warn(`paypal ${method} ${path.replace(/\/[A-Z0-9-]{10,}/g, '/:id')} failed: ${e.status ?? e.code} ${e.message}`);
			throw err;
		}
	};

	return {
		configured,
		mode,
		callCount: () => calls,

		createProduct: async (input: { name: string; description: string }) =>
			call<{ id: string }>('POST', '/v1/catalogs/products', { name: input.name, description: input.description, type: 'SERVICE', category: 'SOFTWARE' }),

		/** A monthly, never-ending plan. Each subscription overrides its price, so the plan price is a placeholder. */
		createPlan: async (input: { product_id: string; name: string; currency: Currency; placeholder_price: number }) =>
			call<{ id: string; status: string }>('POST', '/v1/billing/plans', {
				product_id: input.product_id,
				name: input.name,
				status: 'ACTIVE',
				billing_cycles: [
					{ frequency: { interval_unit: 'MONTH', interval_count: 1 }, tenure_type: 'REGULAR', sequence: 1, total_cycles: 0, pricing_scheme: { fixed_price: amount(input.placeholder_price, input.currency) } },
				],
				payment_preferences: { auto_bill_outstanding: true, setup_fee_failure_action: 'CONTINUE', payment_failure_threshold: 3 },
			}),

		/** A subscription at `monthly` (its own price override), approved by the buyer at approve_url. */
		createSubscription: async (input: { plan_id: string; custom_id: string; monthly: number; currency: Currency; return_url: string; cancel_url: string; brand_name: string; request_id?: string }) => {
			const r = await call<RawSubscription>(
				'POST',
				'/v1/billing/subscriptions',
				{
					plan_id: input.plan_id,
					custom_id: input.custom_id,
					plan: { billing_cycles: [{ sequence: 1, total_cycles: 0, pricing_scheme: { fixed_price: amount(input.monthly, input.currency) } }] },
					// Subscriptions still take the return URLs in application_context (their payment_source only covers cards).
					application_context: { brand_name: input.brand_name, shipping_preference: 'NO_SHIPPING', user_action: 'SUBSCRIBE_NOW', return_url: input.return_url, cancel_url: input.cancel_url },
				},
				input.request_id ? { 'PayPal-Request-Id': input.request_id } : {},
			);
			return { id: r.id, status: r.status, approve_url: linkOf(r.links, 'approve') };
		},

		getSubscription: async (id: string): Promise<PaypalSubscription> => mapSubscription(await call<RawSubscription>('GET', `/v1/billing/subscriptions/${encodeURIComponent(id)}`)),

		/** Sets the monthly price for coming cycles (no buyer consent; PayPal-funded: not within 10 days of a charge). */
		setSubscriptionPrice: async (id: string, monthly: number, currency: Currency): Promise<void> => {
			await call('PATCH', `/v1/billing/subscriptions/${encodeURIComponent(id)}`, [
				{ op: 'replace', path: '/plan/billing_cycles/@sequence==1/pricing_scheme/fixed_price', value: amount(monthly, currency) },
			]);
		},

		cancelSubscription: async (id: string, reason: string): Promise<void> => {
			await call('POST', `/v1/billing/subscriptions/${encodeURIComponent(id)}/cancel`, { reason: reason.slice(0, 127) || 'Cancelled by the customer' });
		},

		/** A one-time payment (token pack, prorated location slots). */
		createOrder: async (input: { amount: number; currency: Currency; custom_id: string; invoice_id?: string; description: string; return_url: string; cancel_url: string; brand_name: string; request_id?: string }): Promise<PaypalOrder> =>
			mapOrder(
				await call<RawOrder>(
					'POST',
					'/v2/checkout/orders',
					{
						intent: 'CAPTURE',
						purchase_units: [{ reference_id: 'default', custom_id: input.custom_id, invoice_id: input.invoice_id, description: input.description.slice(0, 127), amount: amount(input.amount, input.currency) }],
						payment_source: {
							paypal: { experience_context: { brand_name: input.brand_name, shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW', return_url: input.return_url, cancel_url: input.cancel_url } },
						},
					},
					input.request_id ? { 'PayPal-Request-Id': input.request_id } : {},
				),
			),

		getOrder: async (id: string): Promise<PaypalOrder> => mapOrder(await call<RawOrder>('GET', `/v2/checkout/orders/${encodeURIComponent(id)}`)),

		captureOrder: async (id: string, requestId: string): Promise<PaypalOrder> =>
			mapOrder(await call<RawOrder>('POST', `/v2/checkout/orders/${encodeURIComponent(id)}/capture`, {}, { 'PayPal-Request-Id': requestId })),
	};
};

export type PaypalClient = ReturnType<typeof createPaypalClient>;

let defaultClient: PaypalClient | null = null;
/** The shared client (created lazily so tests can set env first). */
export const paypalClient = (): PaypalClient => (defaultClient ??= createPaypalClient());
