import { PlacesApiError, PlacesClient, normalisePlaceId, placesClient } from '../../clients/placesClient';

// Business names at view time, for when STORE_PLACE_NAMES=false (CLAUDE.md §9.2 compliance note).
// Each ID costs one Place Details call (displayName). This fetches third-party data during a
// request, which CLAUDE.md §15 otherwise forbids, so GET map-ranking only calls it when
// STORE_PLACE_NAMES=false AND ?resolveNames=true. Pending Mohit's ToS decision.

export const MAX_RESOLVE_NAMES = 20;

export interface ResolvedNames {
	names: Record<string, string | null>;
	apiCalls: number;
}

export const resolveNames = async (
	placeIds: string[],
	places: Pick<PlacesClient, 'getPlaceDetails'> = placesClient,
): Promise<ResolvedNames> => {
	const ids = [...new Set(placeIds.map((id) => normalisePlaceId(id) as string))].slice(0, MAX_RESOLVE_NAMES);
	const names: Record<string, string | null> = {};
	let apiCalls = 0;
	for (const id of ids) {
		try {
			const result = await places.getPlaceDetails(id, ['displayName']);
			apiCalls += result.apiCalls;
			names[id] = result.details.displayName ?? null;
		} catch (err) {
			if (!(err instanceof PlacesApiError)) throw err; // e.g. no key: let the caller decide
			apiCalls += err.apiCalls;
			names[id] = null;
		}
	}
	return { names, apiCalls };
};
