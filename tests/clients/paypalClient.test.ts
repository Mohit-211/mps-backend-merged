import { createPaypalClient, PaypalConfigError } from '../../src/clients/paypalClient';
import { createFakeTransport } from '../helpers/fakeTransport';

// Phase 13a: the PayPal client against scripted responses (no network). Request shapes follow PayPal's
// Subscriptions v1 / Orders v2 schemas (docs/plans/phase-13-billing-admin.md, 13a.0).

const noSleep = async () => undefined;
const client = (steps: Parameters<typeof createFakeTransport>[0], now = () => 1_000_000) => {
	const fake = createFakeTransport(steps);
	return { fake, pp: createPaypalClient({ transport: fake.transport, clientId: 'id', clientSecret: 'secret', mode: 'sandbox', now, sleep: noSleep }) };
};

describe('paypalClient', () => {
	it('refuses without credentials', async () => {
		const pp = createPaypalClient({ transport: createFakeTransport([]).transport, clientId: '', clientSecret: '' });
		expect(pp.configured()).toBe(false);
		await expect(pp.getSubscription('I-X')).rejects.toBeInstanceOf(PaypalConfigError);
	});

	it('caches the OAuth token until shortly before it expires', async () => {
		let t = 1_000_000;
		const { fake, pp } = client(
			[{ status: 200, fixture: 'paypal/token' }, { status: 200, fixture: 'paypal/subscription_active' }, { status: 200, fixture: 'paypal/subscription_active' }, { status: 200, fixture: 'paypal/token' }, { status: 200, fixture: 'paypal/subscription_active' }],
			() => t,
		);
		await pp.getSubscription('I-BW452GLLEP1G');
		await pp.getSubscription('I-BW452GLLEP1G');
		t += 32_400_000; // the token's expires_in
		await pp.getSubscription('I-BW452GLLEP1G');
		expect(fake.requests.map((r) => r.url.replace('https://api-m.sandbox.paypal.com', ''))).toEqual([
			'/v1/oauth2/token',
			'/v1/billing/subscriptions/I-BW452GLLEP1G',
			'/v1/billing/subscriptions/I-BW452GLLEP1G',
			'/v1/oauth2/token',
			'/v1/billing/subscriptions/I-BW452GLLEP1G',
		]);
		expect(fake.requests[0].headers?.Authorization).toBe(`Basic ${Buffer.from('id:secret').toString('base64')}`);
	});

	it('creates a subscription with its own price override and custom_id; maps the approve link', async () => {
		const { fake, pp } = client([{ status: 200, fixture: 'paypal/token' }, { status: 201, fixture: 'paypal/subscription_created' }]);
		const out = await pp.createSubscription({ plan_id: 'P-USD', custom_id: 'sub_123', monthly: 128, currency: 'USD', return_url: 'https://app.test/settings/billing?result=success', cancel_url: 'https://app.test/settings/billing?result=cancelled', brand_name: 'MyPageSEO', request_id: 'sub_123' });
		expect(out).toEqual({ id: 'I-BW452GLLEP1G', status: 'APPROVAL_PENDING', approve_url: expect.stringContaining('ba_token=') });
		const req = fake.requests[1];
		expect(req).toMatchObject({ method: 'POST', url: 'https://api-m.sandbox.paypal.com/v1/billing/subscriptions' });
		expect(req.headers?.['PayPal-Request-Id']).toBe('sub_123');
		expect(req.data).toMatchObject({
			plan_id: 'P-USD',
			custom_id: 'sub_123',
			plan: { billing_cycles: [{ sequence: 1, total_cycles: 0, pricing_scheme: { fixed_price: { currency_code: 'USD', value: '128.00' } } }] },
			application_context: { shipping_preference: 'NO_SHIPPING', user_action: 'SUBSCRIBE_NOW', return_url: expect.stringContaining('result=success') },
		});
		expect(req.data).not.toHaveProperty('quantity');
	});

	it('reads a subscription (next billing, last payment) and patches its price', async () => {
		const { fake, pp } = client([{ status: 200, fixture: 'paypal/token' }, { status: 200, fixture: 'paypal/subscription_active' }, { status: 204, body: '' }]);
		expect(await pp.getSubscription('I-BW452GLLEP1G')).toMatchObject({ status: 'ACTIVE', next_billing_time: '2026-10-28T10:00:00Z', last_payment: { amount: 128, currency: 'USD' }, failed_payments_count: 0 });
		await pp.setSubscriptionPrice('I-BW452GLLEP1G', 157, 'USD');
		expect(fake.requests[2]).toMatchObject({ method: 'PATCH', data: [{ op: 'replace', path: '/plan/billing_cycles/@sequence==1/pricing_scheme/fixed_price', value: { currency_code: 'USD', value: '157.00' } }] });
	});

	it('orders: create (payer-action link), capture with an idempotency key', async () => {
		const { fake, pp } = client([{ status: 200, fixture: 'paypal/token' }, { status: 201, fixture: 'paypal/order_created' }, { status: 201, fixture: 'paypal/order_captured' }]);
		const order = await pp.createOrder({ amount: 40, currency: 'USD', custom_id: 'ord_1', description: '100 tokens', return_url: 'https://app.test/r', cancel_url: 'https://app.test/c', brand_name: 'MyPageSEO' });
		expect(order).toMatchObject({ id: '5O190127TN364715T', status: 'PAYER_ACTION_REQUIRED', approve_url: expect.stringContaining('checkoutnow') });
		expect(fake.requests[1].data).toMatchObject({ intent: 'CAPTURE', purchase_units: [{ custom_id: 'ord_1', amount: { currency_code: 'USD', value: '40.00' } }], payment_source: { paypal: { experience_context: { user_action: 'PAY_NOW' } } } });
		const captured = await pp.captureOrder(order.id, 'ord_1');
		expect(captured).toMatchObject({ status: 'COMPLETED', capture: { id: '3C679366HH908993F', status: 'COMPLETED', amount: 40, currency: 'USD' } });
		expect(fake.requests[2].headers?.['PayPal-Request-Id']).toBe('ord_1');
	});

	it('errors keep the PayPal name, issue and debug_id; 5xx is retried once', async () => {
		const { pp } = client([{ status: 200, fixture: 'paypal/token' }, { status: 422, fixture: 'paypal/error_unprocessable' }]);
		await expect(pp.captureOrder('5O190127TN364715T', 'k')).rejects.toMatchObject({ status: 422, apiStatus: 'UNPROCESSABLE_ENTITY', reason: 'ORDER_NOT_APPROVED', message: expect.stringContaining('debug_id f1a2b3c4d5e6f') });
		const retry = client([{ status: 200, fixture: 'paypal/token' }, { status: 503, body: {} }, { status: 200, fixture: 'paypal/subscription_active' }]);
		expect((await retry.pp.getSubscription('I-BW452GLLEP1G')).status).toBe('ACTIVE');
		expect(retry.fake.requests).toHaveLength(3);
	});
});
