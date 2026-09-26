import { Types } from 'mongoose';
import { SearchTextParams } from '../../../src/clients/types/places';
import { createPlacesSearchService } from '../../../src/services/onboarding/placesSearch.service';
import { SELF_PLACE_ID, clearDb, createLocation, createUser, startTestDb } from '../../helpers/mongoose';

jest.mock('../../../src/configs/mongoConnection', () => ({ agenda: {} }));

let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
});
afterAll(async () => db.stop());
beforeEach(async () => clearDb());

describe('manual competitor search', () => {
	it('searches near the location (1 call reserved) and leaves the location itself out', async () => {
		const { user } = await createUser('u@test.dev');
		const location = await createLocation(user._id as Types.ObjectId, { country: 'United States' });
		const calls: SearchTextParams[] = [];
		const reserved: number[] = [];
		const service = createPlacesSearchService({
			places: {
				searchTextNamesAddresses: async (params) => {
					calls.push(params);
					return {
						places: [
							{ id: SELF_PLACE_ID, name: 'Maple Leaf Plumbing & Heating', address: '100 Queen St E' },
							{ id: 'ChIJother000000000000001', name: 'Rival Plumbing', address: '5 King St' },
						],
						apiCalls: 1,
					};
				},
			},
			usage: { reserve: async (_u, n) => void reserved.push(n) },
		});
		const result = await service.search(location, user._id, '  rival plumbing ');
		expect(calls[0]).toMatchObject({ textQuery: 'rival plumbing', regionCode: 'us', center: { latitude: 43.6629, longitude: -79.3347 } });
		expect(reserved).toEqual([1]);
		expect(result).toEqual({ results: [{ place_id: 'ChIJother000000000000001', name: 'Rival Plumbing', address: '5 King St' }], api_calls: 1 });
	});

	it('needs coordinates and a supported country', async () => {
		const { user } = await createUser('u@test.dev');
		const service = createPlacesSearchService({ places: { searchTextNamesAddresses: jest.fn() }, usage: { reserve: jest.fn() } });
		const noCenter = await createLocation(user._id as Types.ObjectId, { lat: null, lng: null });
		await expect(service.search(noCenter, user._id, 'x y')).rejects.toMatchObject({ statusCode: 400 });
		const uk = await createLocation(user._id as Types.ObjectId, { country: 'United Kingdom' });
		await expect(service.search(uk, user._id, 'x y')).rejects.toMatchObject({ statusCode: 400 });
	});
});
