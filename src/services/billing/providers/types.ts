import { IncomingHttpHeaders } from 'http';
import { Currency } from '../../../billing/constants';

// The payment-provider interface (Phase 13b). Billing logic talks to payments only through this, in
// provider-neutral terms; PayPal is the only implementation today (providers/paypal.ts). A card
// processor can be added as another implementation without touching billing logic.

/** A provider subscription's state in our terms. */
export type ProviderSubscriptionState = 'approval_pending' | 'active' | 'suspended' | 'cancelled' | 'expired' | 'unknown';

export interface ProviderSubscription {
	id: string;
	state: ProviderSubscriptionState;
	/** Our Subscription id, as given at checkout. */
	customId: string | null;
	startTime: Date | null;
	nextBillingTime: Date | null;
	failedPayments: number;
}

export interface ProviderCapture {
	id: string;
	state: 'completed' | 'pending' | 'declined';
	amount: number;
	currency: string;
}

export interface ProviderOrder {
	id: string;
	approveUrl: string | null;
	capture: ProviderCapture | null;
}

/** A verified webhook, parsed into what billing reacts to. */
export type BillingWebhookEvent =
	| { kind: 'subscription_updated'; subscription: ProviderSubscription }
	| { kind: 'subscription_payment_failed'; providerSubscriptionId: string | null; customId: string | null }
	| { kind: 'subscription_payment'; providerSubscriptionId: string | null; customId: string | null; paymentId: string; amount: number; currency: string | null; paidAt: Date | null }
	| { kind: 'payment_refunded'; paymentRef: string | null; note: string }
	| { kind: 'order_approved'; providerOrderId: string }
	| { kind: 'order_captured'; providerOrderId: string; captureId: string; amount: number }
	| { kind: 'order_capture_denied'; providerOrderId: string }
	| { kind: 'order_capture_pending'; providerOrderId: string | null }
	| { kind: 'ignored' };

export interface ParsedWebhook {
	/** The provider's event id (idempotency). */
	eventId: string;
	/** The provider's event type, for logs. */
	type: string;
	resourceId: string | null;
	event: BillingWebhookEvent;
}

export class OrderNotApprovedError extends Error {
	constructor() {
		super('The buyer has not approved the payment yet.');
		this.name = 'OrderNotApprovedError';
	}
}

export interface PaymentProvider {
	readonly name: 'paypal';
	/** Credentials are set. */
	configured(): boolean;
	/** A subscription can be started in this currency (e.g. its plan exists at the provider). */
	canSubscribe(currency: Currency): boolean;
	/** The renewal amount must be fixed this many days before a renewal to apply to it. */
	readonly renewalLeadDays: number;

	startSubscription(input: { subscriptionId: string; monthly: number; currency: Currency; returnUrl: string; cancelUrl: string; startAt: Date | null }): Promise<{ providerId: string; approveUrl: string | null }>;
	getSubscription(providerId: string): Promise<ProviderSubscription>;
	/** Sets the amount charged from the next renewal on (no buyer consent). */
	setRenewalAmount(providerId: string, monthly: number, currency: Currency): Promise<void>;
	cancelSubscription(providerId: string, reason: string): Promise<void>;

	createOrder(input: { orderId: string; amount: number; currency: Currency; description: string; returnUrl: string; cancelUrl: string }): Promise<{ providerId: string; approveUrl: string | null }>;
	/** Captures an approved order (idempotent; an already-captured order is read back). OrderNotApprovedError before approval. */
	captureOrder(providerOrderId: string, orderId: string): Promise<ProviderOrder>;

	/** True only when the provider confirms this webhook (never throws). */
	verifyWebhook(headers: IncomingHttpHeaders, body: unknown): Promise<boolean>;
	/** A verified webhook body → a billing event (null when malformed). */
	parseWebhook(body: unknown): ParsedWebhook | null;
}
