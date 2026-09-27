import { PlaceIdEntry } from '../../clients/types/places';
import { ResultListPoint } from '../../models/rankResultList.model';

// Encoding of the stored result lists (Phase 12.5). An entry's ID is its movedPlaceId when set (the
// ID it resolves to). Each list is a Buffer of little-endian uint16 indexes into the keyword's dictionary.

export interface ListInput {
	point: string;
	sample: number;
	entries: PlaceIdEntry[] | null;
}

export const resolvedId = (e: PlaceIdEntry): string => e.movedPlaceId ?? e.id;

/** Builds one keyword's dictionary and compact lists. */
export const encodeResultLists = (lists: ListInput[]): { places: string[]; points: ResultListPoint[] } => {
	const places: string[] = [];
	const index = new Map<string, number>();
	const points = lists.map((l): ResultListPoint => {
		if (!l.entries) return { point: l.point, sample: l.sample, result_count: null, ids: null };
		const buf = Buffer.alloc(l.entries.length * 2);
		l.entries.forEach((e, i) => {
			const id = resolvedId(e);
			let n = index.get(id);
			if (n === undefined) {
				n = places.length;
				if (n > 0xffff) throw new Error('too many distinct places for uint16 indexes');
				places.push(id);
				index.set(id, n);
			}
			buf.writeUInt16LE(n, i * 2);
		});
		return { point: l.point, sample: l.sample, result_count: l.entries.length, ids: buf };
	});
	return { places, points };
};

/** The ordered place IDs of one stored list (null when that search failed). */
export const decodeResultList = (places: string[], ids: Buffer | { buffer: Buffer } | null): string[] | null => {
	if (!ids) return null;
	const buf = Buffer.isBuffer(ids) ? ids : Buffer.from((ids as { buffer: Buffer }).buffer);
	const out: string[] = [];
	for (let i = 0; i + 1 < buf.length; i += 2) out.push(places[buf.readUInt16LE(i)]);
	return out;
};
