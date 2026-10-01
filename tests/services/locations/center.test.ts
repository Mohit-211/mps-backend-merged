import { centerView } from '../../../src/services/locations/center';

// 2026-10-01: "Measured around: …" on the location header and the ranking pages.
describe('centerView', () => {
	const base = { address: '100 Queen St E, Toronto, ON M5C 1S6, Canada', city: 'Toronto', state: 'ON', center_label: null };

	it('the business pin (Place Details or GBP) is source place, labelled with its address', () => {
		expect(centerView({ ...base, lat: 43.65, lng: -79.37, center_source: 'place_details' })).toEqual({ source: 'place', label: base.address, lat: 43.65, lng: -79.37 });
		expect(centerView({ ...base, lat: 43.65, lng: -79.37, center_source: 'gbp' })?.source).toBe('place');
		expect(centerView({ ...base, address: 'n/a', lat: 1, lng: 2, center_source: null })?.label).toBe('Toronto, ON');
	});

	it('a center chosen at setup is source manual with its label', () => {
		expect(centerView({ ...base, lat: 27.95, lng: -82.45, center_source: 'manual', center_label: 'Tampa, FL, USA' })).toEqual({ source: 'manual', label: 'Tampa, FL, USA', lat: 27.95, lng: -82.45 });
	});

	it('null without coordinates', () => {
		expect(centerView({ ...base, lat: null, lng: null, center_source: null })).toBeNull();
	});
});
