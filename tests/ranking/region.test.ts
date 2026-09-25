import { regionFromCountry } from '../../src/ranking/region';

describe('regionFromCountry', () => {
	it.each(['US', 'us', 'USA', 'U.S.A.', 'United States', ' united  states ', 'United States of America'])(
		'%p → us',
		(country) => {
			expect(regionFromCountry(country)).toBe('us');
		},
	);

	it.each(['CA', 'ca', 'CAN', 'Canada', ' CANADA '])('%p → ca', (country) => {
		expect(regionFromCountry(country)).toBe('ca');
	});

	it.each(['India', 'UK', 'Mexico', '', null, undefined])('rejects %p', (country) => {
		expect(() => regionFromCountry(country)).toThrow('only US and Canada');
	});
});
