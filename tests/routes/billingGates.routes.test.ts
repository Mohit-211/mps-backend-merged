import express from 'express';
import request from 'supertest';
import { Types } from 'mongoose';
import { BillingPlan, Organization } from '../../src/models';
import { activateBilling, setTrial } from '../helpers/billing';
import { clearDb, createLocation, createUser, ensureOrg, keywordsOf, startTestDb } from '../helpers/mongoose';

// Phase 13a: the billing gates on the real app. Read-only organizations (trial over, no subscription,
// grace expired, suspended) get 402 on actions that cost money or create work; reads stay open.

jest.mock('../../src/configs/mongoConnection', () => ({ agenda: {} }));
jest.mock('../../src/configs/agenda', () => ({ getAgenda: () => ({ schedule: jest.fn(async () => ({})), cancel: jest.fn(async () => 0) }), stopAgenda: jest.fn() }));
jest.mock('../../src/services/common/email.service', () => new Proxy({}, { get: () => jest.fn(async () => true) }));

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const app: express.Express = require('../../src/app').default;
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
}, 60000);
afterAll(async () => db.stop());
beforeEach(async () => clearDb());

const owner = async () => {
	const { user, token } = await createUser('owner@test.dev');
	const org = await ensureOrg(user._id);
	const location = await createLocation(user._id as Types.ObjectId, { tracking: { keywords: keywordsOf('plumber') } });
	return { token, org, location, base: `/api/v1/locations/${String(location._id)}` };
};

describe('billing gates', () => {
	it('after the trial without a subscription: 402 on gated actions, reads stay open', async () => {
		const { token, org, base } = await owner();
		await setTrial(org._id as Types.ObjectId, new Date(Date.now() - 1000));
		const gated = [
			request(app).post(`${base}/refresh`).set(bearer(token)).send({}),
			request(app).post(`${base}/rank-runs`).set(bearer(token)).send({}),
			request(app).put(`${base}/tracking`).set(bearer(token)).send({ keywords: ['drain'] }),
			request(app).get(`${base}/competitor-suggestions`).set(bearer(token)),
			request(app).post('/api/v1/reports').set(bearer(token)).send({ location_id: base.split('/').pop(), type: 'rank_tracker' }),
			request(app).post('/api/v1/locations').set(bearer(token)).send({ place_id: 'ChIJanotherPlace00000001' }),
		];
		for (const res of await Promise.all(gated)) {
			expect(res.status).toBe(402);
			expect(res.body.data).toMatchObject({ reason: 'subscription_required', billing: { state: 'inactive' } });
		}
		expect((await request(app).get('/api/v1/dashboard').set(bearer(token))).status).toBe(200);
		expect((await request(app).get(`${base}/tracking`).set(bearer(token))).status).toBe(200);
		expect((await request(app).get(`${base}/refresh`).set(bearer(token))).status).toBe(200);
		expect((await request(app).get('/api/v1/organization/usage').set(bearer(token))).body.data.billing).toMatchObject({ state: 'inactive', read_only: true });

		await activateBilling(org._id as Types.ObjectId, { quantity: 1 });
		expect((await request(app).put(`${base}/tracking`).set(bearer(token)).send({ keywords: ['drain'] })).status).toBe(200);
	});

	it('past due: full access within the grace period, read-only after it', async () => {
		const { token, org, base } = await owner();
		await setTrial(org._id as Types.ObjectId, new Date(Date.now() - 1000));
		await activateBilling(org._id as Types.ObjectId, { status: 'past_due', billing_method: 'paypal', comp: false, past_due_since: new Date(Date.now() - 3 * 86_400_000) });
		expect((await request(app).put(`${base}/tracking`).set(bearer(token)).send({ keywords: ['drain'] })).status).toBe(200);
		await activateBilling(org._id as Types.ObjectId, { status: 'past_due', billing_method: 'paypal', comp: false, past_due_since: new Date(Date.now() - 8 * 86_400_000) });
		expect((await request(app).put(`${base}/tracking`).set(bearer(token)).send({ keywords: ['drain'] })).status).toBe(402);
	});

	it('an admin suspension: 402 organization_suspended', async () => {
		const { token, org, base } = await owner();
		await Organization.updateOne({ _id: org._id }, { $set: { suspended_at: new Date(), suspended_reason: 'chargeback' } });
		const res = await request(app).put(`${base}/tracking`).set(bearer(token)).send({ keywords: ['drain'] });
		expect([res.status, res.body.data.reason]).toEqual([402, 'organization_suspended']);
	});

	it('a plan without a feature: 403 feature_not_included (all features are on in the standard plan)', async () => {
		const { token, org, base } = await owner();
		expect((await request(app).get(`${base}/citations`).set(bearer(token))).status).toBe(200);
		const custom = await BillingPlan.create({ name: 'No citations', kind: 'custom', organization_id: org._id, entitlements: { citations: false } });
		await Organization.updateOne({ _id: org._id }, { $set: { plan_id: custom._id } });
		const res = await request(app).get(`${base}/citations`).set(bearer(token));
		expect([res.status, res.body.data]).toEqual([403, { reason: 'feature_not_included', feature: 'citations' }]);
		expect((await request(app).get(`${base}/rank-tracker`).set(bearer(token))).status).not.toBe(403);
	});
});
