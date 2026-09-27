import { HttpRequestError } from '../../src/clients/http';
import { PlacesApiError, PlacesConfigError } from '../../src/clients/placesClient';
import { PlaceIdEntry, SearchTextIdsParams, SearchTextIdsResult } from '../../src/clients/types/places';
import { cacheKey, createPool, createRankingEngine } from '../../src/ranking/engine';
import { gridPoints, trackerPoints } from '../../src/ranking/points';
import { GeoPoint, Target } from '../../src/ranking/types';
import { loadPlacesFixture, placeIds } from '../helpers/fakeTransport';

const CENTER: GeoPoint = { lat: 43.6629, lng: -79.3347 };
const noSleep = async (): Promise<void> => undefined;

const page1Target = loadPlacesFixture<{ places: PlaceIdEntry[] }>('searchText_p1_target').places; // target rank 4
const page2Filler = loadPlacesFixture<{ places: PlaceIdEntry[] }>('searchText_p2_filler').places; // competitor at index 5

const targets: Target[] = [
	{ key: 'self', placeId: placeIds.target },
	{ key: 'competitor_1', placeId: placeIds.competitor },
	{ key: 'competitor_2', placeId: 'ChIJnotInAnyFixtureList0001' },
];

type Resolver = (params: SearchTextIdsParams) => SearchTextIdsResult | Error;

const fakePlaces = (resolve: Resolver) => {
	const calls: SearchTextIdsParams[] = [];
	const searchTextIds = jest.fn(async (params: SearchTextIdsParams): Promise<SearchTextIdsResult> => {
		calls.push(params);
		const outcome = resolve(params);
		if (outcome instanceof Error) throw outcome;
		return outcome;
	});
	return { places: { searchTextIds }, calls };
};

const list = (places: PlaceIdEntry[], apiCalls = 1): SearchTextIdsResult => ({
	places,
	pagesFetched: apiCalls,
	apiCalls,
	stoppedEarly: false,
});

const apiError = (apiCalls = 2): PlacesApiError =>
	new PlacesApiError(new HttpRequestError({ code: 'HTTP_ERROR', status: 500, message: 'Internal error' }), apiCalls);

describe('ranking engine: run cache', () => {
	it('searches the shared center once: tracker (5) + 3×3 grid (9) = 13 searches, 1 cache hit', async () => {
		const fake = fakePlaces(() => list(page1Target));
		const engine = createRankingEngine({ places: fake.places, region: 'ca', targets, sleep: noSleep });
		await Promise.all([
			engine.rankKeywordAtPoints('Emergency Plumber', trackerPoints(CENTER, 1.5)),
			engine.rankKeywordAtPoints('emergency plumber', gridPoints(CENTER, 3, 1)),
		]);
		expect(engine.getStats()).toMatchObject({ searches: 13, cacheHits: 1, errors: 0, apiCalls: { ids_only: 13 } });
		expect(fake.calls).toHaveLength(13);
	});

	it('reuses the center for the map section later in the run', async () => {
		const fake = fakePlaces(() => list(page1Target));
		const engine = createRankingEngine({ places: fake.places, region: 'ca', targets, sleep: noSleep });
		await engine.rankKeywordAtPoints('plumber', trackerPoints(CENTER, 1.5));
		const again = await engine.searchPoint('  PLUMBER ', { ...CENTER });
		expect(again).toBe(page1Target);
		expect(fake.calls).toHaveLength(5);
		expect(engine.getStats().cacheHits).toBe(1);
	});

	it('collapses concurrent identical requests into one search', async () => {
		const fake = fakePlaces(() => list(page1Target));
		const engine = createRankingEngine({ places: fake.places, region: 'ca', targets, sleep: noSleep });
		await Promise.all([engine.searchPoint('plumber', CENTER), engine.searchPoint('plumber', CENTER)]);
		expect(fake.calls).toHaveLength(1);
		expect(engine.getStats()).toMatchObject({ searches: 1, cacheHits: 1 });
	});

	it('does not share between keywords, and keys on 5-decimal coordinates', async () => {
		const fake = fakePlaces(() => list(page1Target));
		const engine = createRankingEngine({ places: fake.places, region: 'ca', targets, sleep: noSleep });
		await engine.searchPoint('plumber', CENTER);
		await engine.searchPoint('drain cleaning', CENTER);
		await engine.searchPoint('plumber', { lat: CENTER.lat + 0.000001, lng: CENTER.lng }); // same at 5 dp
		await engine.searchPoint('plumber', { lat: CENTER.lat + 0.00001, lng: CENTER.lng }); // differs at 5 dp
		expect(fake.calls).toHaveLength(3);
		expect(cacheKey('  Plumber  Near Me', CENTER)).toBe('plumber near me|43.66290|-79.33470');
	});
});

describe('ranking engine: targets and requests', () => {
	it('ranks every target from the same list (competitors cost no extra calls)', async () => {
		const fake = fakePlaces(() => list([...page1Target, ...page2Filler], 2));
		const engine = createRankingEngine({ places: fake.places, region: 'ca', targets, sleep: noSleep });
		const ranks = await engine.rankKeywordAtPoints('plumber', trackerPoints(CENTER, 1.5));
		expect(fake.calls).toHaveLength(5);
		for (const { byTarget } of ranks) {
			expect(byTarget).toEqual({
				self: { rank: 4, status: 'ok', samples: [4], spread: null },
				competitor_1: { rank: 26, status: 'ok', samples: [26], spread: null },
				competitor_2: { rank: null, status: 'not_found', samples: [61], spread: null },
			});
		}
		expect(engine.getStats().apiCalls.ids_only).toBe(10);
	});

	it('reports how many results each point returned (full depth: moreResults is always false) and keeps the lists', async () => {
		const fake = fakePlaces((p) => (p.center?.latitude === CENTER.lat ? list(page1Target) : list(page1Target.slice(0, 7))));
		const engine = createRankingEngine({ places: fake.places, region: 'ca', targets, sleep: noSleep });
		const ranks = await engine.rankKeywordAtPoints('plumber', trackerPoints(CENTER, 1.5));
		expect(ranks[0]).toMatchObject({ resultCount: page1Target.length, moreResults: false });
		expect(ranks[1]).toMatchObject({ resultCount: 7, moreResults: false });
		expect(ranks[1].samples).toEqual([{ entries: page1Target.slice(0, 7) }]);
	});

	it('Phase 12.5: full depth (maxPages 3, no stopWhenFound), the region, radius and point', async () => {
		const fake = fakePlaces(() => list(page1Target));
		const engine = createRankingEngine({ places: fake.places, region: 'us', targets, radiusM: 3000, sleep: noSleep });
		const point = gridPoints(CENTER, 3, 1)[0];
		await engine.searchPoint(' Plumber ', point);
		expect(fake.calls[0]).toEqual({
			textQuery: 'Plumber',
			regionCode: 'us',
			center: { latitude: point.lat, longitude: point.lng },
			radiusM: 3000,
			maxPages: 3,
		});
	});

	it('defaults the radius to PLACES_SEARCH_RADIUS_M', async () => {
		const fake = fakePlaces(() => list(page1Target));
		const engine = createRankingEngine({ places: fake.places, region: 'ca', targets, sleep: noSleep });
		await engine.searchPoint('plumber', CENTER);
		expect(fake.calls[0].radiusM).toBe(5000);
	});

	it('validates its options', () => {
		const fake = fakePlaces(() => list([]));
		expect(() => createRankingEngine({ places: fake.places, region: 'ca', targets: [] })).toThrow('target');
		expect(() =>
			createRankingEngine({ places: fake.places, region: 'ca', targets: [targets[0], targets[0]] }),
		).toThrow('unique');
		expect(() => createRankingEngine({ places: fake.places, region: 'ca', targets, concurrency: 9 })).toThrow('concurrency');
		expect(() => createRankingEngine({ places: fake.places, region: 'ca', targets, samples: 6 })).toThrow('samples');
	});
});

describe('ranking engine: errors', () => {
	it('turns a failed search into error cells for every target and counts its calls', async () => {
		const failAt = trackerPoints(CENTER, 1.5)[2]; // S
		const fake = fakePlaces((p) =>
			p.center.latitude === failAt.lat && p.center.longitude === failAt.lng ? apiError(2) : list(page1Target),
		);
		const engine = createRankingEngine({ places: fake.places, region: 'ca', targets, sleep: noSleep });
		const ranks = await engine.rankKeywordAtPoints('plumber', trackerPoints(CENTER, 1.5));
		const south = ranks.find((r) => r.point.label === 'S');
		expect(south?.byTarget).toEqual({
			self: { rank: null, status: 'error', samples: [null], spread: null },
			competitor_1: { rank: null, status: 'error', samples: [null], spread: null },
			competitor_2: { rank: null, status: 'error', samples: [null], spread: null },
		});
		expect(ranks.filter((r) => r.byTarget.self.status === 'ok')).toHaveLength(4);
		expect(south).toMatchObject({ top3: [], resultCount: null, moreResults: false });
		expect(engine.getStats()).toMatchObject({ searches: 5, errors: 1, apiCalls: { ids_only: 4 + 2 } });
		expect(engine.getErrors()).toEqual([
			{ keyword: 'plumber', point: { lat: failAt.lat, lng: failAt.lng }, status: 500, message: expect.stringContaining('Internal error') },
		]);
	});

	it('rethrows a missing key (PlacesConfigError) instead of reporting errors', async () => {
		const fake = fakePlaces(() => new PlacesConfigError());
		const engine = createRankingEngine({ places: fake.places, region: 'ca', targets, sleep: noSleep });
		await expect(engine.rankKeywordAtPoints('plumber', trackerPoints(CENTER, 1.5))).rejects.toThrow(
			'GOOGLE_PLACE_API_KEY not set',
		);
	});
});

describe('ranking engine: concurrency pool and jitter', () => {
	it('never has more than 4 searches in flight, and does reach 4', async () => {
		let inFlight = 0;
		let peak = 0;
		const searchTextIds = jest.fn(async (): Promise<SearchTextIdsResult> => {
			inFlight += 1;
			peak = Math.max(peak, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 5));
			inFlight -= 1;
			return list(page1Target);
		});
		const engine = createRankingEngine({ places: { searchTextIds }, region: 'ca', targets, sleep: noSleep });
		await engine.rankKeywordAtPoints('plumber', gridPoints(CENTER, 7, 1)); // 49 searches
		expect(searchTextIds).toHaveBeenCalledTimes(49);
		expect(peak).toBe(4);
	});

	it('respects a lower concurrency', async () => {
		let inFlight = 0;
		let peak = 0;
		const searchTextIds = jest.fn(async (): Promise<SearchTextIdsResult> => {
			inFlight += 1;
			peak = Math.max(peak, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 2));
			inFlight -= 1;
			return list([]);
		});
		const engine = createRankingEngine({ places: { searchTextIds }, region: 'ca', targets, concurrency: 2, sleep: noSleep });
		await engine.rankKeywordAtPoints('plumber', gridPoints(CENTER, 3, 1));
		expect(peak).toBe(2);
	});

	it('waits a 100–300 ms jitter before each search', async () => {
		const sleep = jest.fn(async (ms: number): Promise<void> => void ms);
		const randoms = [0, 0.5, 0.9999, 0.25, 0.75];
		let i = 0;
		const fake = fakePlaces(() => list(page1Target));
		const engine = createRankingEngine({
			places: fake.places,
			region: 'ca',
			targets,
			sleep,
			random: () => randoms[i++ % randoms.length],
		});
		await engine.rankKeywordAtPoints('plumber', trackerPoints(CENTER, 1.5));
		const delays = sleep.mock.calls.map(([ms]) => ms);
		expect(delays).toHaveLength(5);
		for (const ms of delays) {
			expect(ms).toBeGreaterThanOrEqual(100);
			expect(ms).toBeLessThanOrEqual(300);
		}
		expect(delays).toEqual(expect.arrayContaining([100, 200, 300]));
	});

	it('does not sleep on cache hits', async () => {
		const sleep = jest.fn(noSleep);
		const fake = fakePlaces(() => list(page1Target));
		const engine = createRankingEngine({ places: fake.places, region: 'ca', targets, sleep });
		await engine.searchPoint('plumber', CENTER);
		await engine.searchPoint('plumber', CENTER);
		expect(sleep).toHaveBeenCalledTimes(1);
	});
});

describe('createPool', () => {
	it('runs tasks in FIFO order once a slot frees up', async () => {
		const run = createPool(1);
		const order: number[] = [];
		await Promise.all([1, 2, 3].map((n) => run(async () => void order.push(n))));
		expect(order).toEqual([1, 2, 3]);
	});

	it('releases the slot when a task throws', async () => {
		const run = createPool(1);
		await expect(run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
		await expect(run(async () => 'next')).resolves.toBe('next');
	});
});

describe('ranking engine: repeated sampling (Phase 12.5)', () => {
	const at = (rank: number | null): PlaceIdEntry[] =>
		rank === null ? page2Filler.slice(0, 3) : [...page2Filler.slice(0, rank - 1), { id: placeIds.target }];

	it('searches every point N times; the rank is the median, with every sample and the spread', async () => {
		const seq = [3, 5, 4];
		let i = 0;
		const fake = fakePlaces(() => list(at(seq[i++ % 3])));
		const engine = createRankingEngine({ places: fake.places, region: 'ca', targets: [targets[0]], sleep: noSleep, samples: 3 });
		const [c] = await engine.rankKeywordAtPoints('plumber', [{ label: 'C' as const, ...CENTER }]);
		expect(fake.calls).toHaveLength(3);
		expect(c.byTarget.self).toEqual({ rank: 4, status: 'ok', samples: [3, 5, 4], spread: 2 });
		expect(c.samples).toHaveLength(3);
		expect(engine.getStats()).toMatchObject({ searches: 3, cacheHits: 0 });
	});

	it('samples of one point are spaced by at least the spacing; other points proceed meanwhile', async () => {
		let clock = 0;
		const waits: number[] = [];
		const sleep = async (ms: number) => {
			waits.push(ms);
			clock += ms;
		};
		const fake = fakePlaces(() => list(page1Target));
		const engine = createRankingEngine({
			places: fake.places,
			region: 'ca',
			targets: [targets[0]],
			sleep,
			jitterMs: [0, 0],
			samples: 3,
			sampleSpacingMs: 60_000,
			now: () => clock,
		});
		await engine.rankKeywordAtPoints('plumber', [{ label: 'C' as const, ...CENTER }]);
		expect(fake.calls).toHaveLength(3);
		expect(waits.filter((w) => w >= 59_000)).toHaveLength(2);
	});

	it('a point where most samples failed is an error; one failed sample of three is left out', async () => {
		let n = 0;
		const failing = fakePlaces(() => (n++ % 3 === 0 ? list(at(2)) : apiError(1)));
		const engine = createRankingEngine({ places: failing.places, region: 'ca', targets: [targets[0]], sleep: noSleep, samples: 3 });
		const [c] = await engine.rankKeywordAtPoints('plumber', [{ label: 'C' as const, ...CENTER }]);
		expect(c.byTarget.self).toEqual({ rank: null, status: 'error', samples: [2, null, null], spread: null });
		let m = 0;
		const one = fakePlaces(() => (m++ === 1 ? apiError(1) : list(at(m === 1 ? 2 : 7))));
		const e2 = createRankingEngine({ places: one.places, region: 'ca', targets: [targets[0]], sleep: noSleep, samples: 3 });
		const [d] = await e2.rankKeywordAtPoints('plumber', [{ label: 'C' as const, ...CENTER }]);
		expect(d.byTarget.self).toEqual({ rank: 5, status: 'ok', samples: [2, null, 7], spread: 5 }); // even count: ceil((2+7)/2)
	});

	it('the center is sampled once per keyword and shared by tracker and grid', async () => {
		const fake = fakePlaces(() => list(page1Target));
		const engine = createRankingEngine({ places: fake.places, region: 'ca', targets, sleep: noSleep, samples: 2 });
		await Promise.all([engine.rankKeywordAtPoints('plumber', trackerPoints(CENTER, 1.5)), engine.rankKeywordAtPoints('plumber', gridPoints(CENTER, 3, 1))]);
		expect(fake.calls).toHaveLength(13 * 2);
	});
});
