import express from 'express';
import request from 'supertest';
import { Types } from 'mongoose';
import config from '../../src/configs/config';
import { BillingPlan, Coupon, Invoice, Organization, PaymentOrder, Subscription, TokenLedger, TokenPack } from '../../src/models';
import { standardPlan } from '../../src/services/billing/plans';
import { activateBilling } from '../helpers/billing';
import { addMember, clearDb, createLocation, createUser, ensureOrg, startTestDb } from '../helpers/mongoose';

// Phase 13a: the billing page on the real app, with a fake PayPal client and verified webhooks.

jest.mock('../../src/configs/mongoConnection', () => ({ agenda: {} }));
jest.mock('../../src/configs/agenda', () => ({ getAgenda: () => ({ schedule: jest.fn(async () => ({})), cancel: jest.fn(async () => 0) }), stopAgenda: jest.fn() }));
jest.mock('../../src/services/common/email.service', () => new Proxy({}, { get: () => jest.fn(async () => true) }));

const DAY = 86_400_000;
const mockPaypal = {
	configured: () => true,
	mode: 'sandbox',
	callCount: () => 0,
	createSubscription: jest.fn(async (i: { custom_id: string }) => ({ id: `I-${i.custom_id.slice(-8)}`, status: 'APPROVAL_PENDING', approve_url: 'https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=BA-1' })),
	getSubscription: jest.fn(async (id: string) => ({ id, status: 'ACTIVE', plan_id: 'P-USD', custom_id: null, start_time: null, next_billing_time: new Date(Date.now() + 60 * DAY).toISOString(), last_payment: null, failed_payments_count: 0, subscriber_email: null })),
	setSubscriptionPrice: jest.fn(async () => undefined),
	cancelSubscription: jest.fn(async () => undefined),
	createOrder: jest.fn(async (i: { custom_id: string; amount: number }) => ({ id: `O-${i.custom_id.slice(-8)}`, status: 'PAYER_ACTION_REQUIRED', custom_id: i.custom_id, approve_url: 'https://www.sandbox.paypal.com/checkoutnow?token=O-1', capture: null })),
	getOrder: jest.fn(),
	captureOrder: jest.fn(async (id: string) => {
		const o = await PaymentOrder.findOne({ provider_order_id: id }).lean();
		return { id, status: 'COMPLETED', custom_id: String(o?._id), approve_url: null, capture: { id: `CAP-${id}`, status: 'COMPLETED', amount: o?.amount ?? 0, currency: o?.currency ?? 'USD' } };
	}),
	verifyWebhookSignature: jest.fn(async () => 'SUCCESS'),
};
jest.mock('../../src/clients/paypalClient', () => ({ ...jest.requireActual('../../src/clients/paypalClient'), paypalClient: () => mockPaypal }));

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const app: express.Express = require('../../src/app').default;
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
	config.paypal.planIds.USD = 'P-USD';
	config.paypal.planIds.CAD = 'P-CAD';
	config.paypal.webhookId = 'WH-TEST';
}, 60000);
afterAll(async () => db.stop());
beforeEach(async () => {
	await clearDb();
	jest.clearAllMocks();
});

const setPrices = async () => {
	const plan = await standardPlan();
	await BillingPlan.updateOne(
		{ _id: plan._id },
		{ $set: { prices: [{ currency: 'CAD', first_location_price: 49, additional_location_price: 19, effective_from: new Date('2026-01-01T00:00:00Z'), set_at: new Date() }] } },
	);
};

const owner = async () => {
	const { user, token } = await createUser('owner@test.dev');
	const org = await ensureOrg(user._id);
	await Organization.updateOne({ _id: org._id }, { $set: { token_balance: 0 } });
	return { user, token, org, orgId: org._id as Types.ObjectId };
};

let eventSeq = 0;
// Signed like PayPal does; the (mocked) verify-webhook-signature call answers SUCCESS.
const SIGNED = {
	'paypal-auth-algo': 'SHA256withRSA',
	'paypal-cert-url': 'https://api.sandbox.paypal.com/cert.pem',
	'paypal-transmission-id': 'tx-1',
	'paypal-transmission-sig': 'sig',
	'paypal-transmission-time': '2026-09-28T10:00:00Z',
};
const webhook = (event_type: string, resource: Record<string, unknown>, id = `WH-${++eventSeq}`) =>
	request(app).post('/api/v1/subscription/paypal/webhook').set(SIGNED).send({ id, event_type, resource });

describe('checkout and the subscription lifecycle', () => {
	it('trial → checkout → activated + first payment → invoice; replays are idempotent; renewal advances the period', async () => {
		const { token, orgId, user } = await owner();
		await createLocation(user._id as Types.ObjectId);
		await createLocation(user._id as Types.ObjectId);

		let res = await request(app).get('/api/v1/billing').set(bearer(token));
		expect(res.status).toBe(200);
		expect(res.body.data).toMatchObject({ state: 'trialing', currency: 'CAD', prices: { current: null }, subscription: null, locations: { active: 2 } });

		res = await request(app).post('/api/v1/billing/checkout').set(bearer(token));
		expect(res.status).toBe(409);
		expect(res.body.data.reason).toBe('price_not_set');

		await setPrices();
		res = await request(app).post('/api/v1/billing/checkout').set(bearer(token));
		expect(res.status).toBe(201);
		expect(res.body.data).toMatchObject({ quantity: 2, currency: 'CAD', monthly_amount: 68 });
		expect(res.body.data.approve_url).toContain('paypal.com');
		expect(mockPaypal.createSubscription).toHaveBeenCalledWith(expect.objectContaining({ plan_id: 'P-CAD', monthly: 68, currency: 'CAD' }));
		// A second checkout while approval is pending replaces the first.
		res = await request(app).post('/api/v1/billing/checkout').set(bearer(token));
		expect(res.status).toBe(201);
		expect(await Subscription.countDocuments({ organization_id: orgId, open: true })).toBe(1);
		const sub = await Subscription.findOne({ organization_id: orgId, open: true }).lean();
		const pid = sub?.provider_subscription_id as string;

		const periodEnd = new Date(Date.now() + 30 * DAY);
		res = await webhook('BILLING.SUBSCRIPTION.ACTIVATED', { id: pid, status: 'ACTIVE', custom_id: String(sub?._id), start_time: new Date().toISOString(), billing_info: { next_billing_time: periodEnd.toISOString() } });
		expect(res.status).toBe(200);
		res = await request(app).get('/api/v1/billing').set(bearer(token));
		expect(res.body.data).toMatchObject({ state: 'active', subscription: { status: 'active', paid_quantity: 2 }, locations: { allowed: 2 }, next_renewal: { quantity: 2, amount: 68, fixed: false } });

		const sale = { id: 'SALE-1', amount: { total: '68.00', currency: 'CAD' }, billing_agreement_id: pid, create_time: new Date().toISOString() };
		res = await webhook('PAYMENT.SALE.COMPLETED', sale, 'WH-SALE-1');
		expect(res.body.data).toMatchObject({ handled: true });
		expect((await webhook('PAYMENT.SALE.COMPLETED', sale, 'WH-SALE-1')).body.data).toMatchObject({ duplicate: true });
		await webhook('PAYMENT.SALE.COMPLETED', sale); // same sale, another event id
		const invoices = await Invoice.find({ organization_id: orgId }).lean();
		expect(invoices).toHaveLength(1);
		expect(invoices[0]).toMatchObject({ kind: 'subscription', status: 'paid', total: 68, charged_amount: 68, mismatch: false, currency: 'CAD' });
		expect(invoices[0].lines.map((l) => l.label)).toEqual(['First location', 'Additional locations']);

		res = await request(app).get('/api/v1/billing/invoices').set(bearer(token));
		expect(res.body.data).toMatchObject({ total: 1, invoices: [{ number: invoices[0].number, has_pdf: true }] });
		res = await request(app).get(`/api/v1/billing/invoices/${String(invoices[0]._id)}/pdf`).set(bearer(token)).buffer(true);
		expect(res.status).toBe(200);
		expect(res.headers['content-type']).toBe('application/pdf');

		// Renewal with a snapshot of 3 locations: the new period uses it.
		await Subscription.updateOne({ _id: sub?._id }, { $set: { next_renewal: { period_end: periodEnd, quantity: 3, price: { first: 49, additional: 19 }, amount: 87, fixed_at: new Date(), prepaid_quantity: 0 } } });
		await webhook('PAYMENT.SALE.COMPLETED', { id: 'SALE-2', amount: { total: '87.00', currency: 'CAD' }, billing_agreement_id: pid, create_time: periodEnd.toISOString() });
		const renewed = await Subscription.findById(sub?._id).lean();
		expect(renewed).toMatchObject({ paid_quantity: 3, next_renewal: null });
		expect(renewed?.current_period_start?.getTime()).toBe(periodEnd.getTime());
		expect(renewed?.current_period_end?.getTime() ?? 0).toBeGreaterThan(periodEnd.getTime());
		expect(await Invoice.countDocuments({ organization_id: orgId })).toBe(2);
	});

	it('a failed payment → past_due with grace; cancel keeps access until the period end', async () => {
		const { token, orgId } = await owner();
		const sub = await activateBilling(orgId, { billing_method: 'paypal', provider_subscription_id: 'I-PAYPAL1', comp: false, quantity: 1 });
		await webhook('BILLING.SUBSCRIPTION.PAYMENT.FAILED', { id: 'I-PAYPAL1', status: 'ACTIVE' });
		let res = await request(app).get('/api/v1/billing').set(bearer(token));
		expect(res.body.data).toMatchObject({ state: 'past_due', read_only: false });
		expect(res.body.data.grace_ends_at).toBeTruthy();

		res = await request(app).post('/api/v1/billing/cancel').set(bearer(token)).send({ reason: 'too expensive' });
		expect(res.status).toBe(200);
		expect(mockPaypal.cancelSubscription).toHaveBeenCalledWith('I-PAYPAL1', 'too expensive');
		expect(res.body.data).toMatchObject({ state: 'active', subscription: { status: 'cancelled', cancel_at_period_end: true }, next_renewal: null });
		expect((await Subscription.findById(sub._id).lean())?.open).toBe(false);
		// A new checkout starts when the paid period ends.
		await setPrices();
		res = await request(app).post('/api/v1/billing/checkout').set(bearer(token));
		expect(res.status).toBe(201);
		expect(new Date(res.body.data.starts_at).getTime()).toBe(sub.current_period_end?.getTime());
	});

	it('roles: a member reads, only the owner pays; a client_user gets 403', async () => {
		const { orgId } = await owner();
		const member = await createUser('member@test.dev');
		await addMember(orgId, member.user._id, 'member');
		const cu = await createUser('client@test.dev');
		await addMember(orgId, cu.user._id, 'client_user');
		expect((await request(app).get('/api/v1/billing').set(bearer(member.token))).status).toBe(200);
		expect((await request(app).post('/api/v1/billing/checkout').set(bearer(member.token))).status).toBe(403);
		expect((await request(app).get('/api/v1/billing').set(bearer(cu.token))).status).toBe(403);
	});
});

describe('location slots', () => {
	it('at the paid quantity: 402 with a quote → pay for a slot → capture (idempotent) → the slot is available', async () => {
		const { token, orgId, user } = await owner();
		await setPrices();
		await activateBilling(orgId, { billing_method: 'paypal', provider_subscription_id: 'I-SLOTS', comp: false, quantity: 1, price: { first: 49, additional: 19 } });
		await createLocation(user._id as Types.ObjectId);

		let res = await request(app).get('/api/v1/billing/location-slots/quote?quantity=1').set(bearer(token));
		expect(res.status).toBe(200);
		expect(res.body.data.amount).toBeGreaterThan(0);
		expect(res.body.data.amount).toBeLessThan(19);

		res = await request(app).post('/api/v1/billing/location-slots').set(bearer(token)).send({ quantity: 1 });
		expect(res.status).toBe(201);
		const orderId = res.body.data.provider_order_id as string;
		res = await request(app).post(`/api/v1/billing/orders/${orderId}/capture`).set(bearer(token));
		expect(res.body.data).toMatchObject({ status: 'captured', purpose: 'location_slots', billing: { locations: { allowed: 2 } } });
		// The webhook for the same capture changes nothing.
		await webhook('PAYMENT.CAPTURE.COMPLETED', { id: `CAP-${orderId}`, amount: { value: '5.00', currency_code: 'CAD' }, supplementary_data: { related_ids: { order_id: orderId } } });
		expect((await request(app).post(`/api/v1/billing/orders/${orderId}/capture`).set(bearer(token))).body.data.status).toBe('captured');
		expect(await Subscription.findOne({ organization_id: orgId, open: true }).lean()).toMatchObject({ paid_quantity: 2 });
		expect(await Invoice.countDocuments({ organization_id: orgId, kind: 'location_slots' })).toBe(1);
	});

	it('beyond the plan cap → 403 enterprise_required; manual billing adds the slot now and bills it later', async () => {
		const { token, orgId } = await owner();
		await activateBilling(orgId, { quantity: 20 });
		let res = await request(app).post('/api/v1/billing/location-slots').set(bearer(token)).send({ quantity: 1 });
		expect(res.status).toBe(403);
		expect(res.body.data).toMatchObject({ reason: 'enterprise_required', max: 20 });

		await activateBilling(orgId, { quantity: 2, comp: false, billing_method: 'manual' });
		res = await request(app).post('/api/v1/billing/location-slots').set(bearer(token)).send({ quantity: 1 });
		expect(res.status).toBe(200);
		expect(res.body.data.fulfilled).toBe(true);
		const sub = await Subscription.findOne({ organization_id: orgId, open: true }).lean();
		expect(sub?.paid_quantity).toBe(3);
		expect(sub?.pending_lines).toHaveLength(1);
	});

	it('without a subscription: 402 subscription_required', async () => {
		const { token } = await owner();
		const res = await request(app).get('/api/v1/billing/location-slots/quote').set(bearer(token));
		expect(res.status).toBe(402);
	});
});

describe('tokens', () => {
	it('buy a pack with a coupon → capture → balance + ledger + invoice; a refund takes the tokens back', async () => {
		const { token, orgId } = await owner();
		const pack = await TokenPack.create({ name: 'Starter', tokens: 10, prices: [{ currency: 'CAD', price: 20 }] });
		await Coupon.create({ code: 'HALF', discount_type: 'percent', value: 50, max_redemptions: 1 });

		let res = await request(app).get('/api/v1/billing/token-packs').set(bearer(token));
		expect(res.body.data).toMatchObject({ currency: 'CAD', packs: [{ name: 'Starter', tokens: 10, price: 20 }] });
		res = await request(app).post('/api/v1/billing/coupon/validate').set(bearer(token)).send({ pack_id: String(pack._id), coupon_code: 'half' });
		expect(res.body.data).toMatchObject({ price: 20, discount: 10, total: 10 });
		res = await request(app).post('/api/v1/billing/coupon/validate').set(bearer(token)).send({ pack_id: String(pack._id), coupon_code: 'NOPE' });
		expect(res.body.data.reason).toBe('invalid_coupon');

		res = await request(app).post('/api/v1/billing/tokens/checkout').set(bearer(token)).send({ pack_id: String(pack._id), coupon_code: 'HALF' });
		expect(res.status).toBe(201);
		expect(res.body.data.amount).toBe(10);
		const orderId = res.body.data.provider_order_id as string;
		await webhook('CHECKOUT.ORDER.APPROVED', { id: orderId });
		expect((await Organization.findById(orgId).lean())?.token_balance).toBe(10);
		expect((await Coupon.findOne({ code: 'HALF' }).lean())?.redemptions).toBe(1);

		res = await request(app).get('/api/v1/billing/tokens/ledger').set(bearer(token));
		expect(res.body.data).toMatchObject({ balance: 10, total: 1, entries: [{ type: 'purchase', amount: 10 }] });
		const inv = await Invoice.findOne({ organization_id: orgId, kind: 'token_pack' }).lean();
		expect(inv?.lines.map((l) => l.amount)).toEqual([20, -10]);
		expect(inv?.total).toBe(10);

		await webhook('PAYMENT.CAPTURE.REFUNDED', { id: 'REF-1', links: [{ rel: 'up', href: `https://api.sandbox.paypal.com/v2/payments/captures/${inv?.provider_ref}` }] });
		expect((await Invoice.findById(inv?._id).lean())?.status).toBe('refunded');
		expect((await Organization.findById(orgId).lean())?.token_balance).toBe(0);
		expect(await TokenLedger.countDocuments({ organization_id: orgId, type: 'adjustment' })).toBe(1);
	});
});

describe('details and public pricing', () => {
	it('saves billing details; /pricing is public', async () => {
		const { token } = await owner();
		let res = await request(app).patch('/api/v1/billing/details').set(bearer(token)).send({ name: 'Maple Leaf Inc.', city: 'Toronto' });
		expect(res.body.data).toMatchObject({ name: 'Maple Leaf Inc.', city: 'Toronto', email: null });
		await setPrices();
		await TokenPack.create({ name: 'Starter', tokens: 10, prices: [{ currency: 'CAD', price: 20 }] });
		res = await request(app).get('/api/v1/pricing?country=CA');
		expect(res.status).toBe(200);
		expect(res.body.data).toMatchObject({ currency: 'CAD', prices: { current: { first_location: 49, additional_location: 19 } }, max_locations: 20, token_packs: [{ tokens: 10, price: 20 }] });
		expect((await request(app).get('/api/v1/pricing?country=US')).body.data.prices.current).toBeNull();
	});
});
