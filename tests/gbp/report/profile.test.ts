import { mapServiceItems, profileSection } from '../../../src/gbp/report/profile';
import { GbpProfileSummary } from '../../../src/models/gbpData.model';

// 2026-10-02: the profile section of GET /gbp/report.
describe('profileSection', () => {
	const profile: GbpProfileSummary = {
		title: 'Example Plumbing',
		description: 'We fix pipes.',
		primary_category: 'Plumber',
		additional_categories: ['Drainage service'],
		regular_hours: [{ open_day: 'MONDAY', open_time: '08:00', close_day: 'MONDAY', close_time: '17:00' }],
		special_hour_dates: ['2026-12-25'],
		more_hours_types: [],
		primary_phone: '(214) 555-0100',
		additional_phones: ['(214) 555-0101'],
		website: 'https://example.test',
		service_area: { business_type: 'CUSTOMER_AND_BUSINESS_LOCATION', place_count: 2, region_code: 'US' },
		labels: ['vip'],
		open_status: 'OPEN',
		service_items: 2,
		latlng: { latitude: 32.8, longitude: -96.8 },
		place_id: 'ChIJx',
		maps_uri: 'https://maps.google.com/?cid=1',
		new_review_uri: 'https://search.google.com/local/writereview?placeid=ChIJx',
	};

	it('returns what the profile shows, with attributes and service items', () => {
		const section = profileSection({
			taken_at: new Date('2026-10-01T03:00:00Z'),
			profile,
			attributes: [{ name: 'has_wheelchair_accessible_entrance', value_type: 'BOOL', values: [true] }],
			raw_location: {
				serviceItems: [
					{ structuredServiceItem: { serviceTypeId: 'job_type_id:boiler_repair', description: 'Same day' }, price: { currencyCode: 'USD', units: '120', nanos: 500000000 } },
					{ freeFormServiceItem: { category: 'categories/gcid:plumber', label: { displayName: 'Leak detection', description: null } } },
					{ unknown: true },
				],
			},
		});
		expect(section).toMatchObject({
			available: true,
			title: 'Example Plumbing',
			primary_category: 'Plumber',
			additional_phones: ['(214) 555-0101'],
			maps_uri: 'https://maps.google.com/?cid=1',
			new_review_uri: 'https://search.google.com/local/writereview?placeid=ChIJx',
			attributes: [{ name: 'has_wheelchair_accessible_entrance', value_type: 'BOOL', values: [true] }],
		});
		expect(section?.service_items).toEqual([
			{ name: 'Boiler repair', description: 'Same day', kind: 'structured', price: { currency: 'USD', amount: 120.5 } },
			{ name: 'Leak detection', description: null, kind: 'free_form', price: null },
		]);
	});

	it('null without a synced profile; no service items without raw data', () => {
		expect(profileSection({ taken_at: new Date(), profile: null, attributes: null, raw_location: null })).toBeNull();
		expect(mapServiceItems(undefined)).toEqual([]);
	});
});
