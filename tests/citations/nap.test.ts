import { napMismatches, normaliseAddress, sameAddress } from '../../src/utils/nap';
import { citationCountry, isRegionOf, regionCode } from '../../src/citations/regions';

describe('NAP helpers', () => {
	it('normalises street lines and postal codes (US and CA)', () => {
		expect(normaliseAddress('123 Main Street, Suite 4, Dallas, TX 75201, USA')).toEqual({ street: '123 main st', postal: '75201' });
		expect(normaliseAddress('45 King St. #200, Fredericton, NB E3B 1A1')).toEqual({ street: '45 king st ste 200', postal: 'E3B1A1' });
		expect(normaliseAddress('')).toBeNull();
	});

	it('compares addresses by postal code and street line; null when nothing comparable', () => {
		expect(sameAddress('123 Main Street, Dallas, TX 75201', '123 Main St, Dallas TX 75201-1234')).toBe(true);
		expect(sameAddress('123 Main St, Dallas, TX 75201', '125 Main St, Dallas, TX 75201')).toBe(false);
		expect(sameAddress('123 Main St, Dallas, TX 75201', '123 Main St, Dallas, TX 75202')).toBe(false);
		expect(sameAddress('Dallas, TX', 'Dallas')).toBeNull();
		expect(sameAddress(null, '123 Main St')).toBeNull();
	});

	it('napMismatches lists differing fields; a missing side is not compared', () => {
		const expected = { name: 'Maple Leaf Plumbing & Heating', address: '45 King St, Fredericton, NB E3B 1A1', phone: '(506) 555-0100', website: 'https://mapleleaf.example/' };
		expect(napMismatches(expected, { name: 'Maple Leaf Plumbing and Heating', address: '45 King Street, Fredericton NB E3B1A1', phone: '+1 506-555-0100', website: 'http://www.mapleleaf.example/contact' })).toEqual([]);
		expect(napMismatches(expected, { name: 'Maple Leaf Plumbing', phone: '506-555-0199', address: '47 King St, Fredericton, NB E3B 1A1' })).toEqual(['name', 'address', 'phone']);
		expect(napMismatches(expected, {})).toEqual([]);
	});
});

describe('regions', () => {
	it('maps countries, codes and names', () => {
		expect([citationCountry('United States'), citationCountry('U.S.A.'), citationCountry('Canada'), citationCountry('UK')]).toEqual(['US', 'US', 'CA', null]);
		expect([regionCode('CA', 'NB'), regionCode('CA', 'Québec'), regionCode('US', 'texas'), regionCode('US', 'N/A')]).toEqual(['NB', 'QC', 'TX', null]);
		expect([isRegionOf('US', 'tx'), isRegionOf('CA', 'TX')]).toEqual([true, false]);
	});
});
