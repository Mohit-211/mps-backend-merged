import { Agenda } from 'agenda';
import { Types } from 'mongoose';
import config from '../../../src/configs/config';
import { PlacesConfigError } from '../../../src/clients/placesClient';
import { ILocation, IRankRun, Location, RankRun } from '../../../src/models';
import { createScriptedPlaces, PlacesScript, ScriptContext } from '../../../src/ranking/demo/scriptedPlaces';
import { enqueueRankRun, RunOverCapError } from '../../../src/services/ranking/rankRun.service';
import { executeRankRun } from '../../../src/services/ranking/rankRunExecutor';
import { updateTracking } from '../../../src/services/ranking/tracking.service';
import {
	COMPETITOR_1,
	SELF_PLACE_ID,
	TORONTO,
	clearDb,
	createLocation,
	createUser,
	keywordsOf,
	startTestDb,
} from '../../helpers/mongoose';

const noSleep = async (): Promise<void> => undefined;
const isCenter = (c: ScriptContext): boolean => c.lat.toFixed(5) === TORONTO.lat.toFixed(5) && c.lng.toFixed(5) === TORONTO.lng.toFixed(5);

const fakeAgenda = () => {
	const schedule = jest.fn(async () => ({}));
	return { agenda: { schedule } as unknown as Agenda, schedule };
};

const baseScript = (overrides: Partial<PlacesScript> = {}): PlacesScript => ({
	rank: ({ placeId, ...ctx }) => (placeId === SELF_PLACE_ID ? (isCenter(ctx) ? 2 : 5) : 10),
	candidates: [SELF_PLACE_ID, COMPETITOR_1],
	name: (id, rank) => (id === SELF_PLACE_ID ? 'Maple Leaf Plumbing & Heating' : `Business ${rank}`),
	...overrides,
});

let db: { stop: () => Promise<void> };
let userId: Types.ObjectId;

beforeAll(async () => {
	db = await startTestDb();
}, 120000);
afterAll(async () => db.stop());
beforeEach(async () => {
	await clearDb();
	userId = (await createUser('owner@example.test')).user._id;
});

const newLocation = (overrides: Parameters<typeof createLocation>[1] = {}) =>
	createLocation(userId, {
		tracking: {
			keywords: keywordsOf('Emergency Plumber', 'Drain Cleaning'),
			competitors: [COMPETITOR_1],
			grid: { size: 3, spacing_km: 1 },
		},
		...overrides,
	});

const reload = async (id: Types.ObjectId | string): Promise<ILocation> => (await Location.findOne({ _id: id })) as ILocation;

/** Enqueues (production limits) and executes one run with a script. */
const runOnce = async (location: ILocation, script: PlacesScript, runAt: Date) => {
	const { agenda } = fakeAgenda();
	const fresh = await reload(location._id as Types.ObjectId);
	const queued = await enqueueRankRun(fresh, userId, 'manual', { agenda, now: runAt, planOptions: { env: 'production' } });
	const places = createScriptedPlaces(script);
	const result = await executeRankRun(queued.run_id, { places, engine: { sleep: noSleep }, now: () => runAt });
	const run = (await RankRun.findById(queued.run_id).lean()) as unknown as IRankRun;
	return { queued, result, run, places };
};

describe('rank-run: full run (2 keywords × 3×3)', () => {
	it('ranks tracker + grid + map list, shares the center, and records API calls', async () => {
		const location = await newLocation();
		const { result, run, places } = await runOnce(location, baseScript(), new Date('2026-09-26T10:00:00Z'));

		expect(result.status).toBe('done');
		expect(run).toMatchObject({ status: 'done', active: false, center_source: 'location', failure_reason: null });
		expect(run.duration_ms).toBe(0);
		expect(run.tracker).toHaveLength(2);
		expect(run.grid).toHaveLength(2);
		expect(run.tracker[0].cells).toHaveLength(5);
		expect(run.grid[0].points).toHaveLength(9);
		// 13 unique points per keyword (center shared), 1 page each; 1 Pro call per keyword
		expect(run.api_calls).toEqual({ ids_only: 26, pro: 2, details: 0 });
		expect(places.calls).toEqual({ ids_only: 26, pro: 2, details: 0 });

		const summary = run.tracker[0].summary as unknown as Record<string, Record<string, unknown>>;
		expect(summary.self).toMatchObject({ avgRank: 4.4, foundRate: 1, top3Rate: 0.2, change: null, changeLabel: null });
		expect(summary.competitor_1).toMatchObject({ avgRank: 10, foundRate: 1, top3Rate: 0 });
		const center = run.tracker[0].cells[0];
		expect(center.point.label).toBe('C');
		expect((center.byTarget as unknown as Record<string, unknown>).self).toEqual({ rank: 2, status: 'ok' });
		// The first 3 IDs at each point are stored for calibration; self is 2nd at the center.
		expect(center.top3).toHaveLength(3);
		expect(center.top3?.[1]).toBe(SELF_PLACE_ID);
		expect(run.grid[0].points[0].top3).toHaveLength(3);
		// Search depth per point: found on page 1 of a longer list, so paging stopped early.
		expect(center).toMatchObject({ result_count: 20, more_results: true });
		expect(run.grid[0].points[0].result_count).toBeGreaterThan(0);

		expect(run.mapList[0].results).toHaveLength(20);
		expect(run.mapList[0].results[1]).toMatchObject({
			rank: 2,
			place_id: SELF_PLACE_ID,
			is_self: true,
			target_key: 'self',
			name: 'Maple Leaf Plumbing & Heating',
		});
		expect(run.mapList[0].results[9]).toMatchObject({ rank: 10, place_id: COMPETITOR_1, target_key: 'competitor_1' });
		expect((run.overall as unknown as Record<string, unknown>).self).toEqual({ overallAvgRank: 4.4, change: null });

		const saved = await reload(location._id as Types.ObjectId);
		expect(saved.tracking?.last_run_at).toEqual(new Date('2026-09-26T10:00:00Z'));
		expect(saved.tracking?.last_error).toBeNull();
	});

	it('is idempotent: a second execution of the same run is skipped', async () => {
		const location = await newLocation();
		const { queued } = await runOnce(location, baseScript(), new Date());
		const again = await executeRankRun(queued.run_id, { places: createScriptedPlaces(baseScript()) });
		expect(again.status).toBe('skipped');
	});
});

describe('rank-run: change between runs', () => {
	it('computes improved / entered_top_60 / dropped_out_of_top_60 against the previous run', async () => {
		const location = await newLocation();
		// Run 1: self rank 8 for "emergency plumber", not found for "drain cleaning"; competitor found for drain.
		await runOnce(
			location,
			baseScript({
				rank: ({ placeId, keyword }) => {
					if (placeId === SELF_PLACE_ID) return keyword.toLowerCase().startsWith('emergency') ? 8 : null;
					return keyword.toLowerCase().startsWith('drain') ? 15 : 30;
				},
			}),
			new Date('2026-09-12T10:00:00Z'),
		);
		// Run 2: self improves to 3 and enters the top 60 for drain; competitor drops out for drain.
		const { run } = await runOnce(
			location,
			baseScript({
				rank: ({ placeId, keyword }) => {
					if (placeId === SELF_PLACE_ID) return keyword.toLowerCase().startsWith('emergency') ? 3 : 40;
					return keyword.toLowerCase().startsWith('drain') ? null : 30;
				},
			}),
			new Date('2026-09-19T10:00:00Z'),
		);
		const emergency = run.tracker[0].summary as unknown as Record<string, { change: number | null; changeLabel: string | null }>;
		const drain = run.tracker[1].summary as unknown as Record<string, { change: number | null; changeLabel: string | null }>;
		expect(emergency.self).toMatchObject({ change: 5, changeLabel: 'improved' });
		expect(emergency.competitor_1).toMatchObject({ change: 0, changeLabel: 'unchanged' });
		expect(drain.self).toMatchObject({ change: null, changeLabel: 'entered_top_60' });
		expect(drain.competitor_1).toMatchObject({ change: null, changeLabel: 'dropped_out_of_top_60' });
		// overall self: run1 (8 + 61)/2 = 34.5, run2 (3 + 40)/2 = 21.5 → +13
		expect((run.overall as unknown as Record<string, unknown>).self).toEqual({ overallAvgRank: 21.5, change: 13 });
	});

	it('does not compute change after a keyword edit (new keywords_version)', async () => {
		const location = await newLocation();
		await runOnce(location, baseScript(), new Date('2026-09-12T10:00:00Z'));
		const edited = await updateTracking(await reload(location._id as Types.ObjectId), {
			keywords: ['Emergency Plumber', 'Water Heater Repair'],
		});
		expect(edited.keywords_version_bumped).toBe(true);
		const { run } = await runOnce(location, baseScript(), new Date('2026-09-19T10:00:00Z'));
		expect(run.keywords_version).toBe(2);
		const summary = run.tracker[0].summary as unknown as Record<string, { change: number | null; changeLabel: string | null }>;
		expect(summary.self).toMatchObject({ change: null, changeLabel: null });
		expect((run.overall as unknown as Record<string, { change: number | null }>).self.change).toBeNull();
	});
});

describe('rank-run: errors', () => {
	it('is partial when a search fails, and records the point', async () => {
		const location = await newLocation();
		const failing = (c: ScriptContext) => c.keyword.startsWith('Emergency') && c.lat > TORONTO.lat + 0.005 && c.lng > TORONTO.lng + 0.005;
		const { run } = await runOnce(location, baseScript({ fail: failing }), new Date());
		expect(run.status).toBe('partial');
		expect(run.run_errors).toHaveLength(1);
		expect(run.run_errors[0]).toMatchObject({ keyword: 'Emergency Plumber', section: 'grid' });
		const errorCells = run.grid[0].points.filter(
			(p) => (p.byTarget as unknown as Record<string, { status: string }>).self.status === 'error',
		);
		expect(errorCells).toHaveLength(1);
		expect(run.api_calls.ids_only).toBe(25 + 2); // 25 good pages + the failed search (2 attempts)
	});

	it('is partial when the Map Ranking names search fails', async () => {
		const location = await newLocation();
		const { run } = await runOnce(location, baseScript({ failNames: (k) => k.startsWith('Drain') }), new Date());
		expect(run.status).toBe('partial');
		expect(run.run_errors[0]).toMatchObject({ keyword: 'Drain Cleaning', section: 'map' });
		expect(run.mapList[1].results).toEqual([]);
		expect(run.api_calls.pro).toBe(1 + 2);
	});

	it('is failed only when every search failed', async () => {
		const location = await newLocation();
		const { run } = await runOnce(location, baseScript({ fail: () => true }), new Date());
		expect(run).toMatchObject({ status: 'failed', failure_reason: 'every search failed', active: false });
	});

	it('fails with a reason (and frees the location) when the key is missing', async () => {
		const location = await newLocation();
		const { agenda } = fakeAgenda();
		const queued = await enqueueRankRun(await reload(location._id as Types.ObjectId), userId, 'manual', {
			agenda,
			planOptions: { env: 'production' },
		});
		const places = createScriptedPlaces(baseScript());
		places.searchTextIds = async () => {
			throw new PlacesConfigError();
		};
		const result = await executeRankRun(queued.run_id, { places, engine: { sleep: noSleep } });
		const run = await RankRun.findById(queued.run_id);
		expect(result.status).toBe('failed');
		expect(run).toMatchObject({ status: 'failed', active: false, failure_reason: 'GOOGLE_PLACE_API_KEY not set' });
		expect((await reload(location._id as Types.ObjectId)).tracking?.last_error).toBe('GOOGLE_PLACE_API_KEY not set');
	});
});

describe('rank-run: center resolution and names', () => {
	it('resolves a missing center with ONE Place Details call and saves it to the location', async () => {
		const location = await newLocation({ lat: null, lng: null });
		const { run } = await runOnce(location, baseScript({ details: TORONTO }), new Date());
		expect(run).toMatchObject({ status: 'done', center_source: 'place_details', center: TORONTO });
		expect(run.api_calls.details).toBe(1);
		expect(run.estimate.details.min).toBe(1);
		const saved = await reload(location._id as Types.ObjectId);
		expect({ lat: saved.lat, lng: saved.lng }).toEqual(TORONTO);
	});

	it('fails when the center cannot be resolved', async () => {
		const location = await newLocation({ lat: null, lng: null });
		const { run } = await runOnce(location, baseScript({ details: null }), new Date());
		expect(run.status).toBe('failed');
		expect(run.failure_reason).toContain('Could not resolve the location center');
		expect(run.api_calls.details).toBe(2);
	});

	it('stores no names when STORE_PLACE_NAMES=false', async () => {
		const original = config.ranking.storePlaceNames;
		config.ranking.storePlaceNames = false;
		try {
			const location = await newLocation();
			const { run } = await runOnce(location, baseScript(), new Date());
			expect(run.config.store_place_names).toBe(false);
			expect(run.mapList[0].results.every((r) => r.name === null)).toBe(true);
			expect(run.mapList[0].results[1].is_self).toBe(true);
		} finally {
			config.ranking.storePlaceNames = original;
		}
	});
});

describe('enqueue', () => {
	it('schedules rank-run with job data { run_id } only', async () => {
		const location = await newLocation();
		const { agenda, schedule } = fakeAgenda();
		const queued = await enqueueRankRun(location, userId, 'manual', { agenda, planOptions: { env: 'production' } });
		expect(queued).toMatchObject({ status: 'queued', existing: false, dev_capped: false });
		expect(queued.estimate.idsOnly).toEqual({ min: 26, max: 78, maxWithRetries: 156 });
		expect(schedule).toHaveBeenCalledTimes(1);
		expect(schedule).toHaveBeenCalledWith(expect.any(Date), 'rank-run', { run_id: queued.run_id });
	});

	it('returns the active run instead of creating a second one', async () => {
		const location = await newLocation();
		const { agenda, schedule } = fakeAgenda();
		const first = await enqueueRankRun(location, userId, 'manual', { agenda, planOptions: { env: 'production' } });
		const second = await enqueueRankRun(location, userId, 'manual', { agenda, planOptions: { env: 'production' } });
		expect(second).toMatchObject({ run_id: first.run_id, existing: true });
		expect(schedule).toHaveBeenCalledTimes(1);
	});

	it('creates exactly one run for two concurrent requests (unique active index)', async () => {
		const location = await newLocation();
		const { agenda } = fakeAgenda();
		const results = await Promise.all(
			[1, 2, 3].map(() => enqueueRankRun(location, userId, 'manual', { agenda, planOptions: { env: 'production' } })),
		);
		expect(new Set(results.map((r) => r.run_id)).size).toBe(1);
		expect(await RankRun.countDocuments({ location_id: location._id })).toBe(1);
	});

	it('applies the development limits (2 keywords, 3×3) and reports dev_capped', async () => {
		const location = await newLocation({
			tracking: { keywords: keywordsOf('aa', 'bb', 'cc'), grid: { size: 7, spacing_km: 1 } },
		});
		const { agenda } = fakeAgenda();
		const queued = await enqueueRankRun(location, userId, 'manual', { agenda, planOptions: { env: 'development', devMaxKeywords: 2 } });
		const run = await RankRun.findById(queued.run_id);
		expect(queued.dev_capped).toBe(true);
		expect(run?.keywords).toEqual(['aa', 'bb']);
		expect(run?.config.grid_size).toBe(3);
	});

	it('rejects a run over RANK_MAX_CALLS_PER_RUN with the estimate', async () => {
		const location = await newLocation();
		const { agenda, schedule } = fakeAgenda();
		const promise = enqueueRankRun(location, userId, 'manual', { agenda, planOptions: { env: 'production', maxCallsPerRun: 50 } });
		await expect(promise).rejects.toBeInstanceOf(RunOverCapError);
		await expect(promise).rejects.toMatchObject({ statusCode: 422, cap: 50, estimate: { idsOnly: { max: 78 } } });
		expect(schedule).not.toHaveBeenCalled();
		expect(await RankRun.countDocuments()).toBe(0);
	});

	it.each([
		[{ place_id: null }, 'no place_id'],
		[{ tracking: { keywords: [] } }, 'no tracking keywords'],
		[{ country: 'India' }, 'only US and Canada'],
	])('rejects %j with 400', async (overrides, message) => {
		const location = await newLocation(overrides as Parameters<typeof createLocation>[1]);
		const { agenda } = fakeAgenda();
		await expect(enqueueRankRun(location, userId, 'manual', { agenda })).rejects.toMatchObject({ statusCode: 400 });
		await expect(enqueueRankRun(location, userId, 'manual', { agenda })).rejects.toThrow(message);
	});

	it('marks the run failed and frees the location if scheduling fails', async () => {
		const location = await newLocation();
		const agenda = { schedule: jest.fn(async () => Promise.reject(new Error('db down'))) } as unknown as Agenda;
		await expect(enqueueRankRun(location, userId, 'manual', { agenda, planOptions: { env: 'production' } })).rejects.toMatchObject({
			statusCode: 500,
		});
		const run = await RankRun.findOne({ location_id: location._id });
		expect(run).toMatchObject({ status: 'failed', active: false });
	});
});
