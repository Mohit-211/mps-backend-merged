import { directoryMatches, matchDirectories, MatchDirectory } from '../../src/citations/match';

const dir = (id: string, over: Partial<MatchDirectory> = {}): MatchDirectory => ({ id, is_active: true, countries: ['US', 'CA'], regions: [], category_ids: [], ...over });

describe('directory matching', () => {
	const loc = { country: 'CA' as const, region: 'NB', categoryIds: ['home'] };

	it('general directories (no categories) fit every business in the country', () => {
		expect(directoryMatches(loc, dir('yelp'))).toBe(true);
		expect(directoryMatches(loc, dir('yp-us', { countries: ['US'] }))).toBe(false);
		expect(directoryMatches(loc, dir('off', { is_active: false }))).toBe(false);
	});

	it('niche directories need a shared category group', () => {
		expect(directoryMatches(loc, dir('homestars', { category_ids: ['home'] }))).toBe(true);
		expect(directoryMatches(loc, dir('avvo', { category_ids: ['legal'] }))).toBe(false);
		expect(directoryMatches({ ...loc, categoryIds: [] }, dir('homestars', { category_ids: ['home'] }))).toBe(false);
	});

	it('regions limit a directory to part of the country; an unknown region never matches a regional one', () => {
		expect(directoryMatches(loc, dir('nb-chamber', { countries: ['CA'], regions: ['NB'] }))).toBe(true);
		expect(directoryMatches(loc, dir('on-chamber', { countries: ['CA'], regions: ['ON'] }))).toBe(false);
		expect(directoryMatches({ ...loc, region: null }, dir('nb-chamber', { countries: ['CA'], regions: ['NB'] }))).toBe(false);
	});

	it('matchDirectories returns the matching ids in order', () => {
		expect(matchDirectories(loc, [dir('a'), dir('b', { category_ids: ['legal'] }), dir('c', { category_ids: ['home', 'legal'] })])).toEqual(['a', 'c']);
	});
});
