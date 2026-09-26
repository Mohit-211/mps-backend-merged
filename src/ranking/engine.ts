import logger from '../configs/logger';
import config from '../configs/config';
import { Sleep, defaultSleep } from '../clients/http';
import { PlacesApiError, PlacesClient } from '../clients/placesClient';
import { PlaceIdEntry } from '../clients/types/places';
import { toCell } from './rankCell';
import { GeoPoint, RankCell, Target } from './types';

// Ranking engine (CLAUDE.md §8). Create ONE engine per run: its cache and counters are per run.
// - Every search is an IDs-only Text Search (free SKU) with stopWhenFound = all target place IDs.
// - Run cache keyed by (keyword, lat.toFixed(5), lng.toFixed(5)), holding promises, so the center
//   (and any identical point) is searched once per keyword and shared by tracker, grid and map.
// - At most `concurrency` (≤ 4) searches in flight, each preceded by a 100–300 ms jitter delay.
// - Every target (client and competitors) is ranked from the same result list: no extra calls.

export const MAX_CONCURRENCY = 4;
const DEFAULT_JITTER_MS: [number, number] = [100, 300];

export interface RankingEngineOptions {
	places: Pick<PlacesClient, 'searchTextIds'>;
	/** CLDR region code for every search in this run ('us' | 'ca'). */
	region: string;
	targets: Target[];
	radiusM?: number;
	concurrency?: number;
	jitterMs?: [number, number];
	sleep?: Sleep;
	random?: () => number;
}

export interface PointRanks<P extends GeoPoint> {
	point: P;
	byTarget: Record<string, RankCell>;
	/** First 3 place IDs of the result list at this point (empty when the search failed). */
	top3: string[];
}

export interface EngineStats {
	/** Searches actually sent (cache misses). */
	searches: number;
	cacheHits: number;
	/** Searches that failed after the client's retry (their cells are 'error'). */
	errors: number;
	/** HTTP calls, including pagination and retries. */
	apiCalls: { ids_only: number };
}

export interface SearchError {
	keyword: string;
	point: GeoPoint;
	status: number | string;
	message: string;
}

export const normaliseKeyword = (keyword: string): string => keyword.trim().replace(/\s+/g, ' ').toLowerCase();

export const cacheKey = (keyword: string, point: GeoPoint): string =>
	`${normaliseKeyword(keyword)}|${point.lat.toFixed(5)}|${point.lng.toFixed(5)}`;

/** Runs at most `limit` tasks at once; the rest wait in FIFO order. */
export const createPool = (limit: number) => {
	let active = 0;
	const waiting: (() => void)[] = [];
	const acquire = (): Promise<void> =>
		new Promise((resolve) => {
			if (active < limit) {
				active += 1;
				resolve();
			} else {
				waiting.push(() => {
					active += 1;
					resolve();
				});
			}
		});
	const release = (): void => {
		active -= 1;
		const next = waiting.shift();
		if (next) next();
	};
	return async <T>(task: () => Promise<T>): Promise<T> => {
		await acquire();
		try {
			return await task();
		} finally {
			release();
		}
	};
};

const assertTargets = (targets: Target[]): void => {
	if (targets.length === 0) throw new Error('At least one target is required');
	const keys = new Set(targets.map((t) => t.key));
	if (keys.size !== targets.length) throw new Error('Target keys must be unique');
	for (const t of targets) if (!t.placeId) throw new Error(`Target ${t.key} has no placeId`);
};

export const createRankingEngine = (options: RankingEngineOptions) => {
	assertTargets(options.targets);
	const concurrency = options.concurrency ?? MAX_CONCURRENCY;
	if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) {
		throw new Error(`concurrency must be 1-${MAX_CONCURRENCY}`);
	}
	const [minJitter, maxJitter] = options.jitterMs ?? DEFAULT_JITTER_MS;
	const sleep = options.sleep ?? defaultSleep;
	const random = options.random ?? Math.random;
	const radiusM = options.radiusM ?? config.ranking.searchRadiusM;
	const targets = [...options.targets];
	const targetIds = targets.map((t) => t.placeId);
	const runInPool = createPool(concurrency);
	const cache = new Map<string, Promise<PlaceIdEntry[] | null>>();
	const stats: EngineStats = { searches: 0, cacheHits: 0, errors: 0, apiCalls: { ids_only: 0 } };
	const searchErrors: SearchError[] = [];

	const jitter = (): number => Math.round(minJitter + random() * (maxJitter - minJitter));

	const runSearch = async (keyword: string, point: GeoPoint): Promise<PlaceIdEntry[] | null> =>
		runInPool(async () => {
			await sleep(jitter());
			stats.searches += 1;
			try {
				const result = await options.places.searchTextIds({
					textQuery: keyword.trim(),
					regionCode: options.region,
					center: { latitude: point.lat, longitude: point.lng },
					radiusM,
					stopWhenFound: targetIds,
				});
				stats.apiCalls.ids_only += result.apiCalls;
				return result.places;
			} catch (err) {
				if (err instanceof PlacesApiError) {
					stats.apiCalls.ids_only += err.apiCalls;
					stats.errors += 1;
					searchErrors.push({
						keyword: keyword.trim(),
						point: { lat: point.lat, lng: point.lng },
						status: err.status ?? err.code,
						message: err.message,
					});
					logger.warn(`ranking search failed status=${err.status ?? err.code} calls=${err.apiCalls}`);
					return null;
				}
				throw err; // no key (PlacesConfigError) or a bug: fail the run loudly
			}
		});

	/** Result list for keyword at point (cached per run); null when the search failed after its retry. */
	const searchPoint = (keyword: string, point: GeoPoint): Promise<PlaceIdEntry[] | null> => {
		const key = cacheKey(keyword, point);
		const cached = cache.get(key);
		if (cached) {
			stats.cacheHits += 1;
			return cached;
		}
		const pending = runSearch(keyword, point);
		cache.set(key, pending);
		return pending;
	};

	/** One (cached) search per point, then a RankCell per target from that same list. */
	const rankKeywordAtPoints = async <P extends GeoPoint>(keyword: string, points: P[]): Promise<PointRanks<P>[]> =>
		Promise.all(
			points.map(async (point) => {
				const entries = await searchPoint(keyword, point);
				const byTarget: Record<string, RankCell> = {};
				for (const target of targets) byTarget[target.key] = toCell(entries, target.placeId);
				return { point, byTarget, top3: (entries ?? []).slice(0, 3).map((e) => e.id) };
			}),
		);

	const getStats = (): EngineStats => ({ ...stats, apiCalls: { ...stats.apiCalls } });

	/** Searches that failed after the client's retry (one entry per failed point, not per target). */
	const getErrors = (): SearchError[] => searchErrors.map((e) => ({ ...e, point: { ...e.point } }));

	return { searchPoint, rankKeywordAtPoints, getStats, getErrors };
};

export type RankingEngine = ReturnType<typeof createRankingEngine>;
