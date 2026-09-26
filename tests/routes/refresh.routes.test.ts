import express from 'express';
import request from 'supertest';
import { Types } from 'mongoose';
import { queryTypesArr } from '../../src/configs/constantTypes';
import { GbpSync, RankRun, UserGBP } from '../../src/models';
import { apiErrorHandler, getQueryParams } from '../../src/utils';
import { clearDb, createLocation, createUser, keywordsOf, startTestDb } from '../helpers/mongoose';

jest.mock('../../src/configs/mongoConnection', () => ({ agenda: {} }));
const scheduleMock = jest.fn(async () => ({}));
jest.mock('../../src/configs/agenda', () => ({ getAgenda: () => ({ schedule: scheduleMock, cancel: jest.fn() }), stopAgenda: jest.fn() }));

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const rankingRoute = require('../../src/routes/v1/common/ranking.route').default;
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

const app = express();
app.use(express.json());
app.use(getQueryParams(queryTypesArr));
app.use('/api/v1/locations', rankingRoute);
app.use(apiErrorHandler);

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
	await Promise.all([RankRun.syncIndexes(), GbpSync.syncIndexes(), UserGBP.syncIndexes()]);
}, 60000);
afterAll(async () => db.stop());
beforeEach(async () => {
	await clearDb();
	scheduleMock.mockClear();
});

const owner = async (bound: boolean) => {
	const { user, token } = await createUser(`o${Math.random()}@test.dev`);
	const location = await createLocation(user._id as Types.ObjectId, { tracking: { keywords: keywordsOf('plumber') } });
	if (bound) {
		await UserGBP.create({ user_id: user._id, location_id: location._id, gbpAccountId: 'accounts/1', gbpLocationId: 'locations/1', google_sub: 's' });
	}
	return { token, id: String(location._id) };
};

describe('refresh routes', () => {
	it('401 without a token, 404 for another user, 400 for an unknown type', async () => {
		const { id } = await owner(false);
		const { token: other } = await createUser('x@test.dev');
		expect((await request(app).post(`/api/v1/locations/${id}/refresh`).send({})).status).toBe(401);
		expect((await request(app).post(`/api/v1/locations/${id}/refresh`).set(auth(other)).send({})).status).toBe(404);
		const { token, id: mine } = await owner(false);
		const bad = await request(app).post(`/api/v1/locations/${mine}/refresh`).set(auth(token)).send({ types: ['citations'] });
		expect(bad.status).toBe(400);
	});

	it('POST queues a rank run and a GBP sync (bound), then 429 with next_allowed_at', async () => {
		const { token, id } = await owner(true);
		const res = await request(app).post(`/api/v1/locations/${id}/refresh`).set(auth(token)).send({});
		expect(res.status).toBe(202);
		expect(res.body.data.rankings).toMatchObject({ status: 'queued', existing: false });
		expect(res.body.data.gbp).toMatchObject({ status: 'queued', existing: false, estimated_calls: 12 });
		expect(res.body.data.rankings.next_allowed_at).toBeTruthy();
		expect(scheduleMock.mock.calls.map((c) => (c as unknown[])[1]).sort()).toEqual(['gbp-sync', 'rank-run']);

		// Finish both so nothing is "in progress", then the limit applies.
		await RankRun.updateMany({}, { $set: { active: false, status: 'done' } });
		await GbpSync.updateMany({}, { $set: { active: false, status: 'done' } });
		const again = await request(app).post(`/api/v1/locations/${id}/refresh`).set(auth(token)).send({});
		expect(again.status).toBe(429);
		expect(again.body.data.rankings).toMatchObject({ skipped: 'rate_limited' });
		expect(again.body.data.gbp).toMatchObject({ skipped: 'rate_limited' });

		const state = await request(app).get(`/api/v1/locations/${id}/refresh`).set(auth(token));
		expect(state.status).toBe(200);
		expect(state.body.data).toMatchObject({ frequency: 'auto_monthly', gbp_connected: true });
		expect(state.body.data.rankings.next_allowed_at).toBeTruthy();
	});

	it('GET /gbp/sync: not connected, then the queued sync', async () => {
		const unbound = await owner(false);
		const none = await request(app).get(`/api/v1/locations/${unbound.id}/gbp/sync`).set(auth(unbound.token));
		expect(none.body.data).toEqual({ gbp_connected: false, sync: null, last_synced_at: null });

		const { token, id } = await owner(true);
		await request(app).post(`/api/v1/locations/${id}/refresh`).set(auth(token)).send({ types: ['gbp'] });
		const res = await request(app).get(`/api/v1/locations/${id}/gbp/sync`).set(auth(token));
		expect(res.body.data).toMatchObject({ gbp_connected: true, sync: { status: 'queued', trigger: 'manual', backfill: true } });
		expect(res.body.data.sync.types.performance.status).toBe('pending');
		expect((await request(app).get(`/api/v1/locations/${id}/gbp/sync?syncId=nope`).set(auth(token))).status).toBe(400);
	});
});
