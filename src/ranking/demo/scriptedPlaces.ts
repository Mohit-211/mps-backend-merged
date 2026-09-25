import { createHash } from 'crypto';
import { HttpRequestError } from '../../clients/http';
import { PlacesApiError, PlacesClient, normalisePlaceId } from '../../clients/placesClient';
import {
	NamedPlaceEntry,
	PlaceDetailsField,
	PlaceDetailsResult,
	PlaceIdEntry,
	SearchTextIdsParams,
	SearchTextIdsResult,
	SearchTextParams,
	SearchTextWithNamesResult,
} from '../../clients/types/places';

// A deterministic, offline stand-in for the Places client, driven by a script.
// Used by the Phase 5 tests and by `npm run seed:rank-demo`. It makes NO network calls.
// It mimics the real client's behaviour: 20 results per page, up to 3 pages, stopWhenFound
// paging, PlacesApiError after a failed retry (counted as 2 calls), one page for names.

export interface ScriptContext {
	keyword: string;
	lat: number;
	lng: number;
}

export interface PlacesScript {
	/** Rank (1–60) of placeId for this search, or null when it is not in the results. */
	rank: (ctx: ScriptContext & { placeId: string }) => number | null;
	/** True to make this search fail (after its retry). */
	fail?: (ctx: ScriptContext) => boolean;
	/** True to make the Map Ranking names search fail for this keyword. */
	failNames?: (keyword: string) => boolean;
	/** Display name for a place in the names search. */
	name?: (placeId: string, rank: number) => string;
	/** Location returned by Place Details (center resolution); null to fail it. */
	details?: { lat: number; lng: number } | null;
	/** Place IDs the script ranks (client + competitors); the names search has no stopWhenFound. */
	candidates?: string[];
}

export type ScriptedPlaces = Pick<PlacesClient, 'searchTextIds' | 'searchTextWithNames' | 'getPlaceDetails'> & {
	calls: { ids_only: number; pro: number; details: number };
};

const PAGE = 20;
const DEPTH = 60;

const fillerId = (seed: string, index: number): string =>
	`ChIJ${createHash('sha1').update(`${seed}:${index}`).digest('base64url').slice(0, 23)}`;

const failure = (): PlacesApiError =>
	new PlacesApiError(new HttpRequestError({ code: 'HTTP_ERROR', status: 500, message: 'Internal error encountered.' }), 2);

export const createScriptedPlaces = (script: PlacesScript): ScriptedPlaces => {
	const calls = { ids_only: 0, pro: 0, details: 0 };

	// Full 60-result list for a search, with every scripted target at its rank.
	const buildList = (ctx: ScriptContext, targets: string[]): PlaceIdEntry[] => {
		const seed = `${ctx.keyword.toLowerCase()}|${ctx.lat.toFixed(5)}|${ctx.lng.toFixed(5)}`;
		const slots: (string | null)[] = Array.from({ length: DEPTH }, () => null);
		for (const placeId of targets) {
			const rank = script.rank({ ...ctx, placeId });
			if (rank === null || rank < 1 || rank > DEPTH) continue;
			let index = rank - 1;
			while (index < DEPTH && slots[index] !== null) index += 1; // two targets on one rank: next free slot
			if (index < DEPTH) slots[index] = placeId;
		}
		return slots.map((id, i) => ({ id: id ?? fillerId(seed, i) }));
	};

	const searchTextIds = async (params: SearchTextIdsParams): Promise<SearchTextIdsResult> => {
		const ctx = { keyword: params.textQuery, lat: params.center.latitude, lng: params.center.longitude };
		if (script.fail?.(ctx)) {
			calls.ids_only += 2;
			throw failure();
		}
		const targets = (params.stopWhenFound ?? []).map((id) => normalisePlaceId(id) as string);
		const list = buildList(ctx, targets);
		const maxPages = params.maxPages ?? 3;
		let pages = maxPages;
		if (targets.length > 0) {
			const deepest = Math.max(...targets.map((t) => list.findIndex((p) => p.id === t)));
			const allFound = targets.every((t) => list.some((p) => p.id === t));
			if (allFound) pages = Math.min(maxPages, Math.floor(deepest / PAGE) + 1);
		}
		calls.ids_only += pages;
		return {
			places: list.slice(0, pages * PAGE),
			pagesFetched: pages,
			apiCalls: pages,
			stoppedEarly: pages < maxPages,
		};
	};

	const searchTextWithNames = async (params: SearchTextParams): Promise<SearchTextWithNamesResult> => {
		calls.pro += 1;
		if (script.failNames?.(params.textQuery)) {
			calls.pro += 1;
			throw failure();
		}
		const ctx = { keyword: params.textQuery, lat: params.center.latitude, lng: params.center.longitude };
		const candidates = (script.candidates ?? []).map((id) => normalisePlaceId(id) as string);
		const places: NamedPlaceEntry[] = buildList(ctx, candidates)
			.slice(0, PAGE)
			.map((p, i) => ({ id: p.id, name: script.name ? script.name(p.id, i + 1) : `Business ${i + 1}` }));
		return { places, apiCalls: 1 };
	};

	const getPlaceDetails = async (placeId: string, fields: PlaceDetailsField[]): Promise<PlaceDetailsResult> => {
		calls.details += 1;
		if (!script.details) {
			calls.details += 1;
			throw failure();
		}
		return {
			details: {
				id: normalisePlaceId(placeId),
				...(fields.includes('location')
					? { location: { latitude: script.details.lat, longitude: script.details.lng } }
					: {}),
			},
			apiCalls: 1,
		};
	};

	return { searchTextIds, searchTextWithNames, getPlaceDetails, calls };
};
