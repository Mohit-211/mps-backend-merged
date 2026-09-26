import express from 'express';
import request from 'supertest';
import { Types } from 'mongoose';
import { queryTypesArr } from '../../src/configs/constantTypes';
import { createDemoDetailsClient, writeDemoGbpData } from '../../src/gbp/demo/demoGbp';
import { generateGbpReport } from '../../src/gbp/report/generate';
import { GbpReport, GbpSync, Location, RankRun, UserGBP } from '../../src/models';
import { DEMO_PLACE_IDS } from '../../src/ranking/demo/demoPlaces';
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
const NOW = new Date();

let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
	await Promise.all([GbpReport.syncIndexes(), GbpSync.syncIndexes(), UserGBP.syncIndexes()]);
}, 60000);
afterAll(async () => db.stop());
beforeEach(async () => {
	await clearDb();
	scheduleMock.mockClear();
});

const owner = async (bound: boolean) => {
	const { user, token } = await createUser(`o${Math.random()}@test.dev`);
	const location = await createLocation(user._id as Types.ObjectId, { place_id: DEMO_PLACE_IDS.self, tracking: { keywords: keywordsOf('plumber') } });
	await RankRun.collection.insertOne({
		location_id: location._id,
		status: 'done',
		active: false,
		run_at: NOW,
		overall: { self: { overallAvgRank: 5, change: null } },
		tracker: [{ keyword: 'plumber', summary: { self: { avgRank: 5, foundRate: 1, top3Rate: 0.2 } } }],
		mapList: [{ keyword: 'plumber', results: [{ rank: 1, place_id: DEMO_PLACE_IDS.competitor_1, is_self: false }, { rank: 3, place_id: DEMO_PLACE_IDS.self, is_self: true }] }],
	});
	if (bound) await writeDemoGbpData({ _id: location._id as Types.ObjectId }, user._id as Types.ObjectId, NOW);
	return { token, id: String(location._id) };
};

const generate = (id: string) => generateGbpReport(id, 'rank_run', { places: createDemoDetailsClient(), now: () => NOW, v4Enabled: false });

describe('GET /locations/:id/gbp/report', () => {
	it('401 without a token, 404 for another user, 400 for a bad range, 404 before the first report', async () => {
		const { token, id } = await owner(false);
		const { token: other } = await createUser('x@test.dev');
		expect((await request(app).get(`/api/v1/locations/${id}/gbp/report`)).status).toBe(401);
		expect((await request(app).get(`/api/v1/locations/${id}/gbp/report`).set(auth(other))).status).toBe(404);
		expect((await request(app).get(`/api/v1/locations/${id}/gbp/report?range=7d`).set(auth(token))).status).toBe(400);
		const none = await request(app).get(`/api/v1/locations/${id}/gbp/report`).set(auth(token));
		expect(none.status).toBe(404);
		expect(none.body.message).toContain('No GBP report yet');
	});

	it('bound: returns the chosen range, the score and the comparison', async () => {
		const { token, id } = await owner(true);
		await generate(id);
		const res = await request(app).get(`/api/v1/locations/${id}/gbp/report?range=90d`).set(auth(token));
		expect(res.status).toBe(200);
		const d = res.body.data;
		expect(d).toMatchObject({ range: '90d', gbp_connected: true, v4_enabled: false, generation: { pending: false } });
		expect(d.performance).toMatchObject({ available: true, range: '90d', days: 90 });
		expect(d.performance.ranges).toBeUndefined();
		expect(d.gbp_score).toMatchObject({ available: true, partial: true });
		expect(d.reviews).toEqual({ available: false, reason: 'v4_access_pending' });
		expect(d.competitors.rows[0]).toMatchObject({ is_self: true });
		const def = await request(app).get(`/api/v1/locations/${id}/gbp/report`).set(auth(token));
		expect(def.body.data.performance.range).toBe('28d');
	});

	it('unbound: private sections say gbp_not_connected; the public comparison still works', async () => {
		const { token, id } = await owner(false);
		await generate(id);
		const d = (await request(app).get(`/api/v1/locations/${id}/gbp/report`).set(auth(token))).body.data;
		expect(d.gbp_score).toEqual({ available: false, reason: 'gbp_not_connected' });
		expect(d.performance).toEqual({ available: false, reason: 'gbp_not_connected' });
		expect(d.competitors.available).toBe(true);
	});
});

describe('report triggers on existing endpoints', () => {
	it('GET /refresh shows the report state', async () => {
		const { token, id } = await owner(false);
		await generate(id);
		const d = (await request(app).get(`/api/v1/locations/${id}/refresh`).set(auth(token))).body.data;
		expect(d.report).toMatchObject({ pending: false, scheduled_for: null });
		expect(new Date(d.report.last_generated_at).getTime()).toBe(NOW.getTime());
	});

	it('POST /refresh marks competitor details for refetch', async () => {
		const { token, id } = await owner(false);
		const res = await request(app).post(`/api/v1/locations/${id}/refresh`).set(auth(token)).send({});
		expect(res.status).toBe(202);
		expect((await Location.findById(id).lean())?.gbp_report?.force_competitors_at).toBeInstanceOf(Date);
	});

	it('PUT /tracking with changed competitors requests a report once one exists', async () => {
		const { token, id } = await owner(false);
		await request(app).put(`/api/v1/locations/${id}/tracking`).set(auth(token)).send({ competitors: [DEMO_PLACE_IDS.competitor_2] });
		expect(scheduleMock).not.toHaveBeenCalled(); // no report yet: the first rank run creates it
		await generate(id);
		await request(app).put(`/api/v1/locations/${id}/tracking`).set(auth(token)).send({ competitors: [DEMO_PLACE_IDS.competitor_1] });
		expect(scheduleMock).toHaveBeenCalledWith(expect.any(Date), 'gbp-report', { location_id: id, trigger: 'competitors_changed' });
		scheduleMock.mockClear();
		await Location.updateOne({ _id: id }, { $set: { 'gbp_report.scheduled_for': null } });
		await request(app).put(`/api/v1/locations/${id}/tracking`).set(auth(token)).send({ competitors: [DEMO_PLACE_IDS.competitor_1] });
		expect(scheduleMock).not.toHaveBeenCalled(); // unchanged set
	});
});
