import { normalisePlaceId } from '../clients/placesClient';
import { PlaceIdEntry } from '../clients/types/places';
import { RankBucket, RankCell } from './types';

// Rank cells (CLAUDE.md §4 "Ranking").

/** Deepest measurable rank: 3 pages × 20 results. Anything deeper is "60+". */
export const MAX_RANK = 60;

/**
 * Rank of placeId in a result list (index 0 = rank 1).
 * - null list (search failed after its retry) → status 'error'
 * - match on id or movedPlaceId within the first 60 → status 'ok'
 * - otherwise → status 'not_found' (shown as "60+")
 */
export const toCell = (entries: PlaceIdEntry[] | null, placeId: string): RankCell => {
	if (entries === null) return { rank: null, status: 'error' };
	const target = normalisePlaceId(placeId);
	const limit = Math.min(entries.length, MAX_RANK);
	for (let i = 0; i < limit; i++) {
		const entry = entries[i];
		if (normalisePlaceId(entry.id) === target || normalisePlaceId(entry.movedPlaceId) === target) {
			return { rank: i + 1, status: 'ok' };
		}
	}
	return { rank: null, status: 'not_found' };
};

/** UI bucket: 1–3 pack, 4–10 visible, 11–20 low, 21–60 invisible, 60+ not_found, error. */
export const bucket = (cell: RankCell): RankBucket => {
	if (cell.status === 'error') return 'error';
	if (cell.status === 'not_found' || cell.rank === null) return 'not_found';
	if (cell.rank <= 3) return 'pack';
	if (cell.rank <= 10) return 'visible';
	if (cell.rank <= 20) return 'low';
	return 'invisible';
};

/** Display value: "1"…"60", "60+" for not found, "error" for a failed search. */
export const displayRank = (cell: RankCell): string => {
	if (cell.status === 'error') return 'error';
	if (cell.status === 'not_found' || cell.rank === null) return `${MAX_RANK}+`;
	return String(cell.rank);
};
