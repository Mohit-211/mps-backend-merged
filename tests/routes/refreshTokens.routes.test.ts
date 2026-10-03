import express from 'express';
import request from 'supertest';
import { Types } from 'mongoose';
import { PlacesConfigError } from '../../src/clients/placesClient';
import { BillingPlan, Organization, RankRun, TokenLedger } from '../../src/models';
import { standardPlan } from '../../src/services/billing/plans';
import { createOrganizationForOwner } from '../../src/services/org/context';
import { executeRankRun } from '../../src/services/ranking/rankRunExecutor';
import { failStuckRuns } from '../../src/services/refresh/scheduler.service';
import { clearDb, createLocation, createUser, ensureOrg, keywordsOf, startTestDb } from '../helpers/mongoose';

// Phase 13a: manual refreshes and "run now" spend tokens; a refresh that fails entirely is refunded.

jest.mock('../../src/configs/mongoConnection', () => ({ agenda: {} }));
jest.mock('../../src/configs/agenda', () => ({ getAgenda: () => ({ schedule: jest.fn(async () => ({})), cancel: jest.fn(async () => 0) }), stopAgenda: jest.fn() }));
jest.mock('../../src/services/common/email.service', () => new Proxy({}, { get: () => jest.fn(async () => true) }));

/* oxlint-disable typescript/no-var-requires */
const app: express.Express = require('../../src/app').default;
/* oxlint-enable typescript/no-var-requires */

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
}, 60000);
afterAll(async () => db.stop());
beforeEach(async () => clearDb());

const setup = async (balance: number) => {
	const { user, token } = await createUser('owner@test.dev');
	const org = await ensureOrg(user._id);
	await Organization.updateOne({ _id: org._id }, { $set: { token_balance: balance } });
	const location = await createLocation(user._id as Types.ObjectId, { tracking: { keywords: keywordsOf('plumber') } });
	return { token, orgId: org._id as Types.ObjectId, base: `/api/v1/locations/${String(location._id)}` };
};
const balanceOf = async (orgId: Types.ObjectId) => (await Organization.findById(orgId).lean())?.token_balance;
const failingPlaces = () => {
	const fail = async () => {
		throw new PlacesConfigError();
	};
	return { searchTextIds: fail, searchTextWithNames: fail, searchTextEnterprise: fail, searchTextForSuggestions: fail, getPlaceDetails: fail } as never;
};

describe('tokens on manual refresh', () => {
	it('402 insufficient_tokens without enough tokens; GET refresh shows costs and balance', async () => {
		const { token, base } = await setup(0);
		let res = await request(app).post(`${base}/refresh`).set(bearer(token)).send({});
		expect(res.status).toBe(402);
		expect(res.body.data).toMatchObject({ reason: 'insufficient_tokens', balance: 0, cost: 1, costs_by_type: { rankings: 1, gbp: 1 } });
		expect(await RankRun.countDocuments()).toBe(0);
		res = await request(app).get(`${base}/refresh`).set(bearer(token));
		expect(res.body.data.tokens).toEqual({ cost: { rankings: 1, gbp: 1 }, balance: 0 });
		// The 24 h slot was not used up.
		expect(res.body.data.rankings.next_allowed_at).toBeNull();
	});

	it('spends once per queued refresh, linked to the run; rate-limited and in-progress refreshes cost nothing', async () => {
		const { token, orgId, base } = await setup(3);
		let res = await request(app).post(`${base}/rank-runs`).set(bearer(token));
		expect(res.status).toBe(202);
		const runId = res.body.data.run_id as string;
		expect(await balanceOf(orgId)).toBe(2);
		const spend = await TokenLedger.findOne({ organization_id: orgId, type: 'spend' }).lean();
		expect(spend).toMatchObject({ amount: -1, ref: `rank_run:${runId}`, note: 'Manual rankings refresh' });

		// Still running → the same run, no charge.
		res = await request(app).post(`${base}/refresh`).set(bearer(token)).send({ types: ['rankings'] });
		expect(res.body.data.rankings).toMatchObject({ run_id: runId, existing: true });
		expect(await balanceOf(orgId)).toBe(2);

		// Finished → within 24 h the refresh is rate-limited, no charge.
		await RankRun.updateOne({ _id: runId }, { $set: { status: 'done', active: false } });
		res = await request(app).post(`${base}/refresh`).set(bearer(token)).send({ types: ['rankings'] });
		expect(res.status).toBe(429);
		expect(await balanceOf(orgId)).toBe(2);
	});

	it('a run that fails entirely refunds its tokens (executor and stuck guard), once', async () => {
		const { token, orgId, base } = await setup(2);
		const res = await request(app).post(`${base}/rank-runs`).set(bearer(token));
		const runId = res.body.data.run_id as string;
		expect(await balanceOf(orgId)).toBe(1);
		const result = await executeRankRun(runId, { places: failingPlaces() });
		expect(result.status).toBe('failed');
		expect(await balanceOf(orgId)).toBe(2);
		expect(await TokenLedger.countDocuments({ organization_id: orgId, type: 'refund', ref: `rank_run:${runId}` })).toBe(1);

		// Stuck guard: a paid run that never started.
		const { _id: _ignored, ...copy } = (await RankRun.findById(runId).lean()) as unknown as Record<string, unknown>;
		void _ignored;
		const stuck = await RankRun.create({ ...copy, status: 'queued', active: true, run_at: new Date(Date.now() - 3600_000), failure_reason: null });
		await TokenLedger.create({ organization_id: orgId, type: 'spend', amount: -1, balance_after: 1, ref: `rank_run:${String(stuck._id)}`, at: new Date() });
		await Organization.updateOne({ _id: orgId }, { $inc: { token_balance: -1 } });
		await failStuckRuns(new Date());
		expect(await balanceOf(orgId)).toBe(2);
		// The first run's refund isn't repeated.
		expect(await TokenLedger.countDocuments({ organization_id: orgId, type: 'refund' })).toBe(2);
	});

	it('a cost of 0 makes manual refreshes free', async () => {
		const { token, orgId, base } = await setup(0);
		const plan = await standardPlan();
		await BillingPlan.updateOne({ _id: plan._id }, { $set: { 'tokens_per_refresh.rankings': 0 } });
		const res = await request(app).post(`${base}/refresh`).set(bearer(token)).send({ types: ['rankings'] });
		expect(res.status).toBe(202);
		expect(await TokenLedger.countDocuments({ organization_id: orgId })).toBe(0);
	});

	it('a new organization gets the trial token allowance', async () => {
		const plan = await standardPlan();
		await BillingPlan.updateOne({ _id: plan._id }, { $set: { 'trial.tokens': 3 } });
		const { user } = await createUser('new@test.dev');
		const org = await createOrganizationForOwner(user._id, { name: 'New Org', type: 'business', country: 'US' });
		expect(await balanceOf(org._id as Types.ObjectId)).toBe(3);
		expect(await TokenLedger.findOne({ organization_id: org._id }).lean()).toMatchObject({ type: 'grant', amount: 3, note: 'Trial tokens' });
	});
});
