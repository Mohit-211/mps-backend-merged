import express from 'express';
import request from 'supertest';
import { Types } from 'mongoose';
import config from '../../src/configs/config';
import { queryTypesArr } from '../../src/configs/constantTypes';
import { Location, RankRun } from '../../src/models';
import { createScriptedPlaces, PlacesScript } from '../../src/ranking/demo/scriptedPlaces';
import { executeRankRun } from '../../src/services/ranking/rankRunExecutor';
import { resolveNames } from '../../src/services/ranking/resolveNames';
import { apiErrorHandler, getQueryParams } from '../../src/utils';
import { COMPETITOR_1, SELF_PLACE_ID, clearDb, createLocation, createUser, startTestDb } from '../helpers/mongoose';

// Importing the routers pulls in services that import mongoConnection (which would connect to the
// .env database) and the real agenda. Both are replaced for this test.
jest.mock('../../src/configs/mongoConnection', () => ({ agenda: {} }));
const scheduleMock = jest.fn(async () => ({}));
jest.mock('../../src/configs/agenda', () => ({ getAgenda: () => ({ schedule: scheduleMock }), stopAgenda: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const rankingRoute = require('../../src/routes/v1/common/ranking.route').default;

const app = express();
app.use(express.json());
app.use(getQueryParams(queryTypesArr));
app.use('/api/v1/locations', rankingRoute);
app.use(apiErrorHandler);

const noSleep = async (): Promise<void> => undefined;
const script: PlacesScript = {
	rank: ({ placeId }) => (placeId === SELF_PLACE_ID ? 4 : 12),
	candidates: [SELF_PLACE_ID, COMPETITOR_1],
	name: (id, rank) => (id === SELF_PLACE_ID ? 'Maple Leaf Plumbing & Heating' : `Business ${rank}`),
};

let db: { stop: () => Promise<void> };
let ownerToken: string;
let otherToken: string;
let locationId: string;
const base = (path = '') => `/api/v1/locations/${locationId}${path}`;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** "A day later": clears the 24 h manual-refresh limit so the next run-now is allowed (7b). */
const allowNextManualRun = () => Location.updateOne({ _id: locationId }, { $unset: { 'refresh.last_manual': '' } });

const executeLatestQueued = async (runAt?: Date) => {
	const run = await RankRun.findOne({ location_id: locationId, status: 'queued' });
	if (runAt) await RankRun.updateOne({ _id: run?._id }, { $set: { run_at: runAt } });
	await executeRankRun(String(run?._id), { places: createScriptedPlaces(script), engine: { sleep: noSleep } });
	return String(run?._id);
};

beforeAll(async () => {
	db = await startTestDb();
	await clearDb();
	const owner = await createUser('owner@example.test');
	ownerToken = owner.token;
	otherToken = (await createUser('other@example.test')).token;
	locationId = String((await createLocation(owner.user._id))._id);
}, 120000);
afterAll(async () => db.stop());

describe('auth and ownership', () => {
	it('401 without a token', async () => {
		const res = await request(app).get(base('/tracking'));
		expect(res.status).toBe(401);
	});

	it("404 for another user's location (every endpoint)", async () => {
		for (const [method, path] of [
			['get', '/tracking'],
			['put', '/tracking'],
			['post', '/rank-runs'],
			['get', '/rank-runs'],
			['get', `/rank-runs/${new Types.ObjectId()}`],
			['get', '/rank-tracker'],
			['get', '/grid'],
			['get', '/map-ranking'],
			['get', '/keyword-groups'],
			['post', '/keyword-groups'],
			['get', '/tracking/estimate'],
			['get', '/keyword-history?keyword=plumber'],
		] as const) {
			const res = await request(app)[method](base(path)).set(auth(otherToken)).send({ keywords: ['plumber'] });
			expect({ path, status: res.status }).toEqual({ path, status: 404 });
		}
	});

	it('400 for a malformed location id', async () => {
		const res = await request(app).get('/api/v1/locations/not-an-id/tracking').set(auth(ownerToken));
		expect(res.status).toBe(400);
	});
});

describe('tracking settings', () => {
	it('GET returns defaults for a location without settings', async () => {
		const res = await request(app).get(base('/tracking')).set(auth(ownerToken));
		expect(res.status).toBe(200);
		expect(res.body.data.tracking).toMatchObject({
			keywords: [],
			keywords_version: 1,
			competitors: [],
			grid: { size: 7, spacing_km: 2.667, radius_km: 8 },
			frequency: 'auto_monthly',
		});
		expect(res.body.data.estimate.keywords).toBe(0);
		expect(res.body.data).toMatchObject({ cap: expect.any(Number), over_cap: false, expected_duration_ms: expect.any(Number) });
	});

	it('PUT validates the body', async () => {
		const cases: [Record<string, unknown>, RegExp][] = [
			[{}, /at least one tracking field/],
			[{ grid: { size: 4, spacing_km: 1 } }, /size/],
			[{ competitors: [SELF_PLACE_ID] }, /own place_id/],
			[{ keywords: ['a'] }, /2-80 characters/],
			[{ frequency: 'daily' }, /frequency/],
			[{ frequency: 'weekly' }, /frequency/],
			[{ keywords: ['plumber'], next_run_at: '2026-10-01T00:00:00Z' }, /next_run_at is no longer supported/],
		];
		for (const [body, message] of cases) {
			const res = await request(app).put(base('/tracking')).set(auth(ownerToken)).send(body);
			expect(res.status).toBe(400);
			expect(res.body.message).toMatch(message);
		}
	});

	it('PUT saves settings, and GET returns them with an estimate', async () => {
		const put = await request(app)
			.put(base('/tracking'))
			.set(auth(ownerToken))
			.send({
				keywords: ['Emergency Plumber', 'Drain Cleaning', 'emergency plumber'],
				competitors: [COMPETITOR_1],
				grid: { size: 3, spacing_km: 1 },
				frequency: 'manual_only',
			});
		expect(put.status).toBe(200);
		expect(put.body.data).toMatchObject({ keywords_version_bumped: false, dev_capped: false });
		expect(put.body.data.tracking.keywords).toEqual([
			{ text: 'Emergency Plumber', normalized: 'emergency plumber' },
			{ text: 'Drain Cleaning', normalized: 'drain cleaning' },
		]);
		expect(put.body.data.estimate.idsOnly).toEqual({ min: 26, max: 78, maxWithRetries: 156 });

		const get = await request(app).get(base('/tracking')).set(auth(ownerToken));
		expect(get.body.data.tracking.competitors).toEqual([COMPETITOR_1]);
		expect(get.body.data.tracking.frequency).toBe('manual_only');
	});

	it('PUT sets the grid by radius (Phase 17) and refuses an impossible grid with invalid_grid', async () => {
		const put = await request(app).put(base('/tracking')).set(auth(ownerToken)).send({ grid: { size: 3, radius_km: 1 } });
		expect(put.status).toBe(200);
		expect(put.body.data.tracking.grid).toEqual({ size: 3, spacing_km: 1, radius_km: 1 });
		for (const grid of [{ size: 13, radius_km: 0.5 }, { size: 3, radius_km: 1, spacing_km: 1 }, { size: 9 }, { size: 15, radius_km: 5 }]) {
			const res = await request(app).put(base('/tracking')).set(auth(ownerToken)).send({ grid });
			expect(res.status).toBe(400);
			expect(res.body.data).toEqual(expect.objectContaining({ reason: 'invalid_grid' }));
		}
	});

	it('GET tracking/estimate prices a grid without saving it', async () => {
		const res = await request(app).get(base('/tracking/estimate?size=13&radius_km=15&keywords=20')).set(auth(ownerToken));
		expect(res.status).toBe(200);
		expect(res.body.data).toMatchObject({
			grid: { size: 13, radius_km: 15, spacing_km: 2.5 },
			keywords: 20,
			tracker_offset_km: 7.5,
			cap: expect.any(Number),
			over_cap: expect.any(Boolean),
			expected_duration_ms: expect.any(Number),
			token_cost: { rankings: expect.any(Number) },
		});
		expect(res.body.data.points_per_keyword).toBe(169); // the tracker points at 7.5 km fall on the grid
		expect(res.body.data.estimate.idsOnly.max).toBe(169 * 20 * 3 * res.body.data.estimate.samples);
		// Defaults: the saved settings.
		const saved = await request(app).get(base('/tracking/estimate')).set(auth(ownerToken));
		expect(saved.body.data).toMatchObject({ grid: { size: 3, radius_km: 1 }, keywords: 2 });
		expect(saved.body.data.estimate.idsOnly.max).toBe(78);
		const bad = await request(app).get(base('/tracking/estimate?size=13&radius_km=0.5')).set(auth(ownerToken));
		expect(bad.status).toBe(400);
		expect(bad.body.data.reason).toBe('invalid_grid');
	});
});

describe('rank runs and reports', () => {
	it('page endpoints return 404 before the first completed run', async () => {
		for (const path of ['/rank-tracker', '/grid', '/map-ranking']) {
			const res = await request(app).get(base(path)).set(auth(ownerToken));
			expect(res.status).toBe(404);
			expect(res.body.message).toBe('No completed run yet');
			expect(res.body.data).toEqual({ reason: 'no_completed_run' });
		}
	});

	it('POST queues a run (202) with the estimate; a repeat POST returns the same run', async () => {
		const first = await request(app).post(base('/rank-runs')).set(auth(ownerToken)).send({});
		expect(first.status).toBe(202);
		expect(first.body.data).toMatchObject({ status: 'queued', existing: false, dev_capped: false });
		expect(first.body.data.estimate.idsOnly.max).toBe(78);
		expect(scheduleMock).toHaveBeenCalledWith(expect.any(Date), 'rank-run', { run_id: first.body.data.run_id });

		const second = await request(app).post(base('/rank-runs')).set(auth(ownerToken)).send({});
		expect(second.status).toBe(202);
		expect(second.body.data).toMatchObject({ run_id: first.body.data.run_id, existing: true });
	});

	it('page endpoints return 409 for a run that is not finished', async () => {
		const queued = await RankRun.findOne({ location_id: locationId, status: 'queued' });
		const res = await request(app).get(base(`/rank-tracker?runId=${queued?._id}`)).set(auth(ownerToken));
		expect(res.status).toBe(409);
		expect(res.body.data).toEqual({ reason: 'run_not_finished', status: 'queued' });
		expect((await request(app).get(base(`/rank-tracker?runId=${new Types.ObjectId()}`)).set(auth(ownerToken))).body.data).toEqual({ reason: 'run_not_found' });
	});

	it('GET rank-runs/:runId shows status and API calls after the run', async () => {
		const runId = await executeLatestQueued(new Date('2026-09-19T10:00:00Z'));
		const res = await request(app).get(base(`/rank-runs/${runId}`)).set(auth(ownerToken));
		expect(res.status).toBe(200);
		expect(res.body.data).toMatchObject({
			run_id: runId,
			status: 'done',
			trigger: 'manual',
			keywords: ['Emergency Plumber', 'Drain Cleaning'],
			api_calls: { ids_only: 78, pro: 10, details: 0 },
			errors_count: 0,
			failure_reason: null,
		});
	});

	it('GET rank-tracker returns summaries, cell views, overall and trend', async () => {
		const res = await request(app).get(base('/rank-tracker')).set(auth(ownerToken));
		expect(res.status).toBe(200);
		const data = res.body.data;
		expect(data.run).toMatchObject({ status: 'done', keywords_version: 1 });
		expect(data.targets).toEqual([
			{ key: 'self', place_id: SELF_PLACE_ID, name: 'Maple Leaf Plumbing & Heating' },
			// No run, suggestion or API key yet when the competitor was saved: no name (Phase 17).
			{ key: 'competitor_1', place_id: COMPETITOR_1, name: null },
		]);
		expect(data.keywords).toHaveLength(2);
		expect(data.keywords[0].summary.self).toMatchObject({ avgRank: 4, foundRate: 1, top3Rate: 0 });
		expect(data.keywords[0].cells[0]).toMatchObject({
			point: { label: 'C' },
			byTarget: { self: { rank: 4, status: 'ok', bucket: 'visible', display: '4' } },
		});
		expect(data.overall.self).toEqual({ overallAvgRank: 4, change: null, comparable_keywords: 0, keywords_total: 2 });
		expect(data.trend).toHaveLength(1);
	});

	it('GET grid returns heatmap points, filtered by keyword', async () => {
		const all = await request(app).get(base('/grid')).set(auth(ownerToken));
		expect(all.body.data.grid).toEqual({ size: 3, spacing_km: 1, radius_km: 1 });
		expect(all.body.data.keywords).toHaveLength(2);
		const one = await request(app).get(base('/grid?keyword=drain%20cleaning')).set(auth(ownerToken));
		expect(one.status).toBe(200);
		expect(one.body.data.keywords).toHaveLength(1);
		expect(one.body.data.keywords[0].points).toHaveLength(9);
		expect(one.body.data.keywords[0].points[0]).toMatchObject({ row: 0, col: 0, byTarget: { self: { display: '4' } } });
		const missing = await request(app).get(base('/grid?keyword=roofing')).set(auth(ownerToken));
		expect(missing.status).toBe(404);
	});

	it('GET map-ranking returns the top 20 with names and the client highlighted', async () => {
		const res = await request(app).get(base('/map-ranking?keyword=Emergency%20Plumber')).set(auth(ownerToken));
		expect(res.status).toBe(200);
		expect(res.body.data.names_stored).toBe(true);
		const results = res.body.data.keywords[0].results;
		expect(results).toHaveLength(20);
		expect(results[3]).toEqual({
			rank: 4,
			place_id: SELF_PLACE_ID,
			name: 'Maple Leaf Plumbing & Heating',
			// Phase 17 map pins
			address: '103 Demo Street',
			lat: expect.any(Number),
			lng: expect.any(Number),
			is_self: true,
			target_key: 'self',
		});
		expect(res.body.data).toMatchObject({ point: 'C', points_available: ['C', 'N', 'S', 'E', 'W'], attribution: { provider: 'Google' } });
		expect(res.body.data.keywords[0].point).toBe('C');
	});

	it('Phase 12.5: map-ranking ?point= selects a tracker point, all returns the five side by side', async () => {
		const north = await request(app).get(base('/map-ranking?keyword=Emergency%20Plumber&point=n')).set(auth(ownerToken));
		expect(north.status).toBe(200);
		expect(north.body.data).toMatchObject({ point: 'N', keywords: [{ keyword: 'Emergency Plumber', point: 'N' }] });
		const all = await request(app).get(base('/map-ranking?keyword=Emergency%20Plumber&point=all')).set(auth(ownerToken));
		expect(all.body.data.keywords.map((k: { point: string }) => k.point)).toEqual(['C', 'N', 'S', 'E', 'W']);
		expect((await request(app).get(base('/map-ranking?point=X')).set(auth(ownerToken))).status).toBe(400);
		const grid = await request(app).get(base('/grid?keyword=Emergency%20Plumber')).set(auth(ownerToken));
		expect(grid.body.data.keywords[0].points[0].byTarget.self).toMatchObject({ samples: [expect.any(Number)], spread: null });
	});

	it('?runId= shows an older run; trend and history list both runs', async () => {
		await allowNextManualRun();
		await request(app).post(base('/rank-runs')).set(auth(ownerToken)).send({});
		const secondRunId = await executeLatestQueued(new Date('2026-09-26T10:00:00Z'));
		const first = (await RankRun.findOne({ location_id: locationId, _id: { $ne: secondRunId } }))?._id;

		const latest = await request(app).get(base('/rank-tracker')).set(auth(ownerToken));
		expect(latest.body.data.run.run_id).toBe(secondRunId);
		expect(latest.body.data.trend.map((t: { run_id: string }) => t.run_id)).toEqual([String(first), secondRunId]);
		expect(latest.body.data.keywords[0].summary.self).toMatchObject({ change: 0, changeLabel: 'unchanged' });

		const older = await request(app).get(base(`/rank-tracker?runId=${first}`)).set(auth(ownerToken));
		expect(older.body.data.run.run_id).toBe(String(first));

		const list = await request(app).get(base('/rank-runs?page=1&limit=1')).set(auth(ownerToken));
		expect(list.body.data).toMatchObject({ page: 1, limit: 1, total: 2 });
		expect(list.body.data.runs[0]).toMatchObject({ run_id: secondRunId, status: 'done', keywords_version: 1 });
		expect(list.body.data.runs[0].overall.self.overallAvgRank).toBe(4);
	});

	it('422 with the estimate when a run is over RANK_MAX_CALLS_PER_RUN', async () => {
		const original = config.ranking.maxCallsPerRun;
		config.ranking.maxCallsPerRun = 10;
		try {
			await allowNextManualRun();
			const res = await request(app).post(base('/rank-runs')).set(auth(ownerToken)).send({});
			expect(res.status).toBe(422);
			expect(res.body.data).toMatchObject({ cap: 10, estimate: { idsOnly: { max: 78 } } });
		} finally {
			config.ranking.maxCallsPerRun = original;
		}
	});

	it('validates report query parameters', async () => {
		const res = await request(app).get(base('/grid?runId=123')).set(auth(ownerToken));
		expect(res.status).toBe(400);
	});
});

describe('keyword groups (Phase 17)', () => {
	let groupId: string;

	it('POST creates a group of tracked keywords; GET lists it with the tracked spelling', async () => {
		const res = await request(app).post(base('/keyword-groups')).set(auth(ownerToken)).send({ name: ' Emergency  work ', keywords: ['emergency PLUMBER'] });
		expect(res.status).toBe(201);
		expect(res.body.data).toEqual({ group_id: expect.any(String), name: 'Emergency work', keywords: ['Emergency Plumber'] });
		groupId = res.body.data.group_id;
		const list = await request(app).get(base('/keyword-groups')).set(auth(ownerToken));
		expect(list.body.data).toEqual({ groups: [res.body.data], limit: 20 });
	});

	it('refuses untracked keywords, a taken name, and an unknown group', async () => {
		const unknown = await request(app).post(base('/keyword-groups')).set(auth(ownerToken)).send({ name: 'Heaters', keywords: ['water heater repair'] });
		expect(unknown.status).toBe(400);
		expect(unknown.body.data).toEqual({ reason: 'unknown_keyword', keywords: ['water heater repair'] });
		const taken = await request(app).post(base('/keyword-groups')).set(auth(ownerToken)).send({ name: 'EMERGENCY WORK', keywords: ['drain cleaning'] });
		expect(taken.status).toBe(409);
		expect(taken.body.data.reason).toBe('group_name_taken');
		const missing = await request(app).patch(base(`/keyword-groups/${new Types.ObjectId()}`)).set(auth(ownerToken)).send({ name: 'x' });
		expect(missing.status).toBe(404);
		expect(missing.body.data.reason).toBe('group_not_found');
		expect((await request(app).post(base('/keyword-groups')).set(auth(ownerToken)).send({ name: 'No keywords' })).status).toBe(400);
	});

	it('rank-tracker returns group summaries and filters with ?group=; grid filters too', async () => {
		const all = await request(app).get(base('/rank-tracker')).set(auth(ownerToken));
		expect(all.body.data.group).toBeNull();
		expect(all.body.data.groups).toEqual([
			{
				group_id: groupId,
				name: 'Emergency work',
				keywords: ['Emergency Plumber'],
				keywords_in_run: 1,
				summary: expect.objectContaining({ self: expect.objectContaining({ avgRank: expect.any(Number), comparable_keywords: expect.any(Number) }) }),
			},
		]);
		const filtered = await request(app).get(base(`/rank-tracker?group=${groupId}`)).set(auth(ownerToken));
		expect(filtered.body.data.group).toEqual({ group_id: groupId, name: 'Emergency work' });
		expect(filtered.body.data.keywords.map((k: { keyword: string }) => k.keyword)).toEqual(['Emergency Plumber']);
		const grid = await request(app).get(base(`/grid?group=${groupId}`)).set(auth(ownerToken));
		expect(grid.body.data.keywords.map((k: { keyword: string }) => k.keyword)).toEqual(['Emergency Plumber']);
		const bad = await request(app).get(base(`/rank-tracker?group=${new Types.ObjectId()}`)).set(auth(ownerToken));
		expect(bad.status).toBe(404);
		expect(bad.body.data.reason).toBe('group_not_found');
	});

	it('PATCH renames and changes keywords; removing a keyword from tracking removes it from its groups', async () => {
		const patched = await request(app).patch(base(`/keyword-groups/${groupId}`)).set(auth(ownerToken)).send({ name: 'Urgent', keywords: ['Emergency Plumber', 'Drain Cleaning'] });
		expect(patched.status).toBe(200);
		expect(patched.body.data).toEqual({ group_id: groupId, name: 'Urgent', keywords: ['Emergency Plumber', 'Drain Cleaning'] });
		const before = (await request(app).get(base('/tracking')).set(auth(ownerToken))).body.data.tracking.keywords.map((k: { text: string }) => k.text);
		await request(app).put(base('/tracking')).set(auth(ownerToken)).send({ keywords: ['Emergency Plumber'] });
		const list = await request(app).get(base('/keyword-groups')).set(auth(ownerToken));
		expect(list.body.data.groups[0].keywords).toEqual(['Emergency Plumber']);
		await request(app).put(base('/tracking')).set(auth(ownerToken)).send({ keywords: before });
	});

	it('DELETE removes the group', async () => {
		const res = await request(app).delete(base(`/keyword-groups/${groupId}`)).set(auth(ownerToken));
		expect(res.body.data).toEqual({ deleted: true, group_id: groupId });
		expect((await request(app).get(base('/keyword-groups')).set(auth(ownerToken))).body.data.groups).toEqual([]);
	});
});

describe('keyword history (Phase 17)', () => {
	it('lists one keyword across the finished runs, oldest first, with targets per run', async () => {
		const res = await request(app).get(base('/keyword-history?keyword=EMERGENCY%20plumber')).set(auth(ownerToken));
		expect(res.status).toBe(200);
		expect(res.body.data.keyword).toBe('Emergency Plumber');
		const runs = res.body.data.runs as { run_id: string; run_at: string; targets: unknown[]; summary: Record<string, { avgRank: number }> }[];
		const finished = await RankRun.countDocuments({ location_id: locationId, status: { $in: ['done', 'partial'] } });
		expect(runs).toHaveLength(finished);
		expect(runs.map((r) => r.run_at)).toEqual([...runs.map((r) => r.run_at)].sort());
		expect(runs[0]).toMatchObject({ run_id: expect.any(String), status: expect.any(String), targets: expect.any(Array), summary: { self: { avgRank: 4 } } });
		const one = await request(app).get(base('/keyword-history?keyword=emergency%20plumber&limit=1')).set(auth(ownerToken));
		expect(one.body.data.runs).toHaveLength(1);
		expect(one.body.data.runs[0].run_id).toBe(runs[runs.length - 1].run_id);
	});

	it('404 keyword_not_tracked for a keyword that is not tracked; 400 without a keyword', async () => {
		const res = await request(app).get(base('/keyword-history?keyword=roofing')).set(auth(ownerToken));
		expect(res.status).toBe(404);
		expect(res.body.data).toEqual({ reason: 'keyword_not_tracked' });
		expect((await request(app).get(base('/keyword-history')).set(auth(ownerToken))).status).toBe(400);
	});
});

describe('names at view time (STORE_PLACE_NAMES=false)', () => {
	it('resolveNames makes one Details call per unique ID, max 20', async () => {
		const places = createScriptedPlaces({ ...script, details: { lat: 1, lng: 2 } });
		places.getPlaceDetails = jest.fn(async (id: string) => ({ details: { id, displayName: `Name of ${id}` }, apiCalls: 1 }));
		const ids = Array.from({ length: 25 }, (_, i) => `ChIJresolveNameTest${String(i).padStart(4, '0')}`);
		const { names, apiCalls } = await resolveNames([...ids, ids[0]], places);
		expect(Object.keys(names)).toHaveLength(20);
		expect(apiCalls).toBe(20);
		expect(names[ids[0]]).toBe(`Name of ${ids[0]}`);
	});

	it('map-ranking serves null names unless ?resolveNames=true, which needs the key', async () => {
		const original = config.ranking.storePlaceNames;
		config.ranking.storePlaceNames = false;
		try {
			await allowNextManualRun();
			await request(app).post(base('/rank-runs')).set(auth(ownerToken)).send({});
			await executeLatestQueued(new Date('2026-09-27T10:00:00Z'));
			const plain = await request(app).get(base('/map-ranking')).set(auth(ownerToken));
			expect(plain.body.data.names_stored).toBe(false);
			expect(plain.body.data.keywords[0].results.every((r: { name: string | null; address: string | null; lat: number | null }) => r.name === null && r.address === null && r.lat === null)).toBe(true);
			const resolved = await request(app).get(base('/map-ranking?resolveNames=true')).set(auth(ownerToken));
			expect(resolved.status).toBe(503);
			expect(resolved.body.message).toMatch('GOOGLE_PLACE_API_KEY not set');
		} finally {
			config.ranking.storePlaceNames = original;
		}
	});
});

describe('manual refresh limit (7b)', () => {
	it('run now shares the 24 h rankings refresh limit: 429 with next_allowed_at inside the window', async () => {
		await RankRun.updateMany({ location_id: locationId, active: true }, { $set: { active: false, status: 'failed' } });
		await Location.updateOne({ _id: locationId }, { $set: { 'refresh.last_manual.rankings': new Date() } });
		const limited = await request(app).post(base('/rank-runs')).set(auth(ownerToken)).send({});
		expect(limited.status).toBe(429);
		expect(new Date(limited.body.data.next_allowed_at).getTime()).toBeGreaterThan(Date.now());
	});
});

