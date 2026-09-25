import { PlaceIdEntry } from '../../src/clients/types/places';
import { MAX_RANK, bucket, displayRank, toCell } from '../../src/ranking/rankCell';
import { RankCell } from '../../src/ranking/types';
import { loadPlacesFixture, placeIds } from '../helpers/fakeTransport';

type Page = { places: PlaceIdEntry[] };
const page = (name: string): PlaceIdEntry[] => loadPlacesFixture<Page>(name).places;
const filler = (n: number, prefix = 'F'): PlaceIdEntry[] => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}` }));

describe('toCell', () => {
	it('finds the target on page 1 at rank 4', () => {
		expect(toCell(page('searchText_p1_target'), placeIds.target)).toEqual({ rank: 4, status: 'ok' });
	});

	it('finds the target on page 3 at rank 47', () => {
		const list = [...page('searchText_p1_filler'), ...page('searchText_p2_filler'), ...page('searchText_p3_target')];
		expect(toCell(list, placeIds.target)).toEqual({ rank: 47, status: 'ok' });
	});

	it('ranks 1 and 60 at the edges', () => {
		expect(toCell([{ id: 'T' }, ...filler(59)], 'T')).toEqual({ rank: 1, status: 'ok' });
		expect(toCell([...filler(59), { id: 'T' }], 'T')).toEqual({ rank: 60, status: 'ok' });
	});

	it('reports not_found when the target is not in the 60 results', () => {
		const list = [...page('searchText_p1_filler'), ...page('searchText_p2_filler'), ...page('searchText_p3_filler')];
		expect(list).toHaveLength(60);
		expect(toCell(list, placeIds.target)).toEqual({ rank: null, status: 'not_found' });
	});

	it('never ranks deeper than 60', () => {
		expect(toCell([...filler(60), { id: 'T' }], 'T')).toEqual({ rank: null, status: 'not_found' });
	});

	it('honours movedPlaceId', () => {
		expect(toCell(page('searchText_moved'), placeIds.target)).toEqual({ rank: 2, status: 'ok' });
	});

	it('treats a failed search (null) as error', () => {
		expect(toCell(null, placeIds.target)).toEqual({ rank: null, status: 'error' });
	});

	it('accepts "places/" resource names on either side', () => {
		expect(toCell([{ id: 'X' }, { id: 'places/T' }], 'T')).toEqual({ rank: 2, status: 'ok' });
		expect(toCell([{ id: 'T' }], 'places/T')).toEqual({ rank: 1, status: 'ok' });
	});

	it('handles an empty list as not_found', () => {
		expect(toCell([], 'T').status).toBe('not_found');
	});
});

describe('bucket and displayRank', () => {
	const ok = (rank: number): RankCell => ({ rank, status: 'ok' });

	it.each([
		[1, 'pack'],
		[3, 'pack'],
		[4, 'visible'],
		[10, 'visible'],
		[11, 'low'],
		[20, 'low'],
		[21, 'invisible'],
		[60, 'invisible'],
	])('rank %i → %s', (rank, expected) => {
		expect(bucket(ok(rank))).toBe(expected);
	});

	it('not_found and error have their own buckets', () => {
		expect(bucket({ rank: null, status: 'not_found' })).toBe('not_found');
		expect(bucket({ rank: null, status: 'error' })).toBe('error');
	});

	it('displays 60+ for not_found and "error" for errors', () => {
		expect(displayRank(ok(7))).toBe('7');
		expect(displayRank({ rank: null, status: 'not_found' })).toBe(`${MAX_RANK}+`);
		expect(displayRank({ rank: null, status: 'error' })).toBe('error');
	});
});
