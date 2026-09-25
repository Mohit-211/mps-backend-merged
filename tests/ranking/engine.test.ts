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
				self: { rank: 4, status: 'ok' },
				competitor_1: { rank: 26, status: 'ok' },
				competitor_2: { rank: null, status: 'not_found' },
			});
		}
		expect(engine.getStats().apiCalls.ids_only).toBe(10);
	});

	it('sends stopWhenFound = all target IDs, the region, radius and point', async () => {
		const fake = fakePlaces(() => list(page1Target));
		const engine = createRankingEngine({ places: fake.places, region: 'us', targets, radiusM: 3000, sleep: noSleep });
		const point = gridPoints(CENTER, 3, 1)[0];
		await engine.searchPoint(' Plumber ', point);
		expect(fake.calls[0]).toEqual({
			textQuery: 'Plumber',
			regionCode: 'us',
			center: { latitude: point.lat, longitude: point.lng },
			radiusM: 3000,
			stopWhenFound: targets.map((t) => t.placeId),
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
		expect(() => createRankingEngine({ places: fake.places, region: 'ca', targets, concurrency: 5 })).toThrow(
			'concurrency',
		);
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
			self: { rank: null, status: 'error' },
			competitor_1: { rank: null, status: 'error' },
			competitor_2: { rank: null, status: 'error' },
		});
		expect(ranks.filter((r) => r.byTarget.self.status === 'ok')).toHaveLength(4);
		expect(engine.getStats()).toMatchObject({ searches: 5, errors: 1, apiCalls: { ids_only: 4 + 2 } });
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
