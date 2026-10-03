import express from 'express';
import request from 'supertest';
import { Types } from 'mongoose';
import { BillingPlan, Invoice, Organization, Subscription } from '../../src/models';
import { loadEntitlement } from '../../src/services/billing/entitlement.service';
import { createAdmin } from '../helpers/admin';
import { clearDb, createLocation, createUser, ensureOrg, startTestDb } from '../helpers/mongoose';

// Phase 13a: the billing admin on the real app (guards are covered by adminGuards.routes.test.ts).

jest.mock('../../src/configs/mongoConnection', () => ({ agenda: {} }));
jest.mock('../../src/configs/agenda', () => ({ getAgenda: () => ({ schedule: jest.fn(async () => ({})), cancel: jest.fn(async () => 0) }), stopAgenda: jest.fn() }));
jest.mock('../../src/services/common/email.service', () => new Proxy({}, { get: () => jest.fn(async () => true) }));

/* oxlint-disable typescript/no-var-requires */
const app: express.Express = require('../../src/app').default;
/* oxlint-enable typescript/no-var-requires */

const DAY = 86_400_000;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const base = '/api/v1/admin/billing';
let db: { stop: () => Promise<void> };
let adminToken: string;
beforeAll(async () => {
	db = await startTestDb();
}, 60000);
afterAll(async () => db.stop());
beforeEach(async () => {
	await clearDb();
	adminToken = (await createAdmin('admin', 'Billing Admin')).token;
});

const customer = async (email = 'owner@test.dev') => {
	const { user } = await createUser(email);
	const org = await ensureOrg(user._id);
	await Organization.updateOne({ _id: org._id }, { $set: { token_balance: 0 } });
	return { user, orgId: org._id as Types.ObjectId };
};

describe('billing admin', () => {
	it('standard plan: settings and a dated price (history kept, past dates refused), audit-logged', async () => {
		let res = await request(app).get(`${base}/plans`).set(bearer(adminToken));
		expect(res.status).toBe(200);
		const plan = res.body.data[0];
		expect(plan).toMatchObject({ kind: 'standard', max_locations: 20, users_per_location: 3, prices: [] });

		res = await request(app).patch(`${base}/plans/${plan.id}`).set(bearer(adminToken)).send({ tokens_per_refresh: { gbp: 2 }, trial: { days: 14 } });
		expect(res.body.data).toMatchObject({ tokens_per_refresh: { rankings: 1, gbp: 2 }, trial: { days: 14, locations: 1 } });
		expect((await request(app).patch(`${base}/plans/${plan.id}`).set(bearer(adminToken)).send({ max_locations: null })).body.data.reason).toBe('invalid_plan');

		const tomorrow = new Date(Date.now() + DAY).toISOString();
		res = await request(app).post(`${base}/plans/${plan.id}/prices`).set(bearer(adminToken)).send({ currency: 'USD', first_location_price: 39, additional_location_price: 15, effective_from: tomorrow });
		expect(res.status).toBe(201);
		res = await request(app).post(`${base}/plans/${plan.id}/prices`).set(bearer(adminToken)).send({ currency: 'USD', first_location_price: 45, additional_location_price: 15, effective_from: new Date(Date.now() + 40 * DAY).toISOString() });
		expect(res.body.data.prices.map((p: { first_location_price: number }) => p.first_location_price)).toEqual([39, 45]);
		res = await request(app).post(`${base}/plans/${plan.id}/prices`).set(bearer(adminToken)).send({ currency: 'USD', first_location_price: 1, additional_location_price: 1, effective_from: '2020-01-01' });
		expect(res.body.data.reason).toBe('effective_from_in_past');

		res = await request(app).get(`${base}/audit`).set(bearer(adminToken));
		expect(res.body.data.entries.map((e: { action: string }) => e.action)).toEqual(['billing.plan.price', 'billing.plan.price', 'billing.plan.update']);
		expect(res.body.data.entries[0].by.name).toBe('Billing Admin');
	});

	it('enterprise: a custom plan with no cap and manual billing → invoice → payment recorded; overdue → read-only', async () => {
		const { user, orgId } = await customer();
		for (let i = 0; i < 2; i += 1) await createLocation(user._id as Types.ObjectId);
		let res = await request(app).post(`${base}/organizations/${String(orgId)}/custom-plan`).set(bearer(adminToken)).send({ max_locations: null, users_per_location: 5, billing_method: 'manual' });
		expect(res.status).toBe(201);
		const planId = res.body.data.id as string;
		await request(app).post(`${base}/plans/${planId}/prices`).set(bearer(adminToken)).send({ currency: 'CAD', first_location_price: 100, additional_location_price: 10, effective_from: new Date().toISOString() });

		res = await request(app).post(`${base}/organizations/${String(orgId)}/manual-subscription`).set(bearer(adminToken)).send({ quantity: 30 });
		expect(res.status).toBe(201);
		const inv = await Invoice.findOne({ organization_id: orgId }).lean();
		expect(inv).toMatchObject({ kind: 'manual', status: 'open', total: 390 });
		let e = (await loadEntitlement(String(orgId))).entitlement;
		expect(e).toMatchObject({ state: 'active', locations: { allowed: 30, max: null }, users: { limit: 150 } });

		// Unpaid past due + 7 days grace → read-only.
		e = (await loadEntitlement(String(orgId), new Date(Date.now() + 22 * DAY))).entitlement;
		expect(e).toMatchObject({ state: 'inactive', read_only: true });

		res = await request(app).post(`${base}/invoices/${String(inv?._id)}/payments`).set(bearer(adminToken)).send({ note: 'wire 4411' });
		expect(res.body.data).toMatchObject({ status: 'paid' });
		expect((await request(app).post(`${base}/invoices/${String(inv?._id)}/payments`).set(bearer(adminToken)).send({ note: 'again' })).body.data.reason).toBe('invoice_not_open');
		expect((await loadEntitlement(String(orgId), new Date(Date.now() + 22 * DAY))).entitlement.state).toBe('active');

		res = await request(app).get(`${base}/organizations/${String(orgId)}`).set(bearer(adminToken));
		expect(res.body.data).toMatchObject({ organization: { billing_method: 'manual', plan_id: planId }, billing: { state: 'active' } });
		expect(res.body.data.audit.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['billing.custom_plan.create', 'billing.subscription.manual_start', 'billing.invoice.paid']));

		// Back to standard.
		await Subscription.updateMany({ organization_id: orgId }, { $set: { open: false, status: 'cancelled' } });
		res = await request(app).delete(`${base}/organizations/${String(orgId)}/custom-plan`).set(bearer(adminToken));
		expect(res.body.data).toEqual({ plan_id: null });
		expect(await BillingPlan.findById(planId).lean()).toMatchObject({ is_active: false });
	});

	it('comp and token grants (13b: the trial extension moved to PATCH /admin/organizations/:id/trial)', async () => {
		const { orgId } = await customer();
		let res = await request(app).post(`${base}/organizations/${String(orgId)}/manual-subscription`).set(bearer(adminToken)).send({ quantity: 3, comp_until: new Date(Date.now() + 90 * DAY).toISOString() });
		expect(res.status).toBe(201);
		expect(await Invoice.countDocuments({ organization_id: orgId })).toBe(0);

		res = await request(app).post(`${base}/organizations/${String(orgId)}/tokens`).set(bearer(adminToken)).send({ amount: 5, type: 'grant', note: 'goodwill' });
		expect(res.body.data).toEqual({ balance: 5 });
		res = await request(app).post(`${base}/organizations/${String(orgId)}/tokens`).set(bearer(adminToken)).send({ amount: -9, note: 'fix' });
		expect(res.status).toBe(409);
		res = await request(app).get(`${base}/organizations/${String(orgId)}/tokens/ledger`).set(bearer(adminToken));
		expect(res.body.data.entries[0]).toMatchObject({ type: 'grant', amount: 5, by: 'MyPageSEO team', note: 'goodwill' });
	});

	it('token packs and coupons', async () => {
		let res = await request(app).post(`${base}/token-packs`).set(bearer(adminToken)).send({ name: 'Starter', tokens: 10, prices: [{ currency: 'USD', price: 20 }, { currency: 'CAD', price: 27 }] });
		expect(res.status).toBe(201);
		const packId = res.body.data.id as string;
		res = await request(app).patch(`${base}/token-packs/${packId}`).set(bearer(adminToken)).send({ is_active: false });
		expect(res.body.data.is_active).toBe(false);
		res = await request(app).post(`${base}/coupons`).set(bearer(adminToken)).send({ code: 'launch10', discount_type: 'percent', value: 10, pack_ids: [packId], max_redemptions: 100 });
		expect(res.body.data).toMatchObject({ code: 'LAUNCH10', redemptions: 0 });
		expect((await request(app).post(`${base}/coupons`).set(bearer(adminToken)).send({ code: 'LAUNCH10', discount_type: 'fixed', value: 1 })).body.data.reason).toBe('code_taken');
		expect((await request(app).post(`${base}/coupons`).set(bearer(adminToken)).send({ code: 'BIG', discount_type: 'percent', value: 150 })).status).toBe(400);
		expect((await request(app).get(`${base}/coupons`).set(bearer(adminToken))).body.data).toHaveLength(1);
	});
});
