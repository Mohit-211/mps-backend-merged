import { Types } from 'mongoose';
import { PlacesConfigError } from '../../../src/clients/placesClient';
import { PlaceDetailsResult } from '../../../src/clients/types/places';
import { ILocation, Location, RankRun } from '../../../src/models';
import { createCompetitorInfoService } from '../../../src/services/ranking/competitorInfo';
import { updateTracking } from '../../../src/services/ranking/tracking.service';
import { COMPETITOR_1, COMPETITOR_2, SELF_PLACE_ID, clearDb, createLocation, createUser, startTestDb } from '../../helpers/mongoose';

// Phase 17: competitor names, addresses and positions from the suggestion cache, the latest Map Ranking
// lists, then one Place Details call (usage-capped); a failure never blocks saving.

const COMPETITOR_3 = 'ChIJcompetitorTestId00003';

let db: { stop: () => Promise<void> };
let userId: Types.ObjectId;

beforeAll(async () => {
	db = await startTestDb();
}, 120000);
afterAll(async () => db.stop());
beforeEach(async () => {
	await clearDb();
	userId = (await createUser('owner@example.test')).user._id as Types.ObjectId;
});

const fakes = (fail?: Error) => {
	const detailsCalls: string[] = [];
	const reserved: number[] = [];
	const places = {
		getPlaceDetails: async (placeId: string): Promise<PlaceDetailsResult> => {
			detailsCalls.push(placeId);
			if (fail) throw fail;
			return { details: { displayName: `Details ${placeId.slice(-1)}`, formattedAddress: '9 Details Rd', location: { latitude: 43.7, longitude: -79.4 } }, apiCalls: 1 };
		},
	};
	const usage = { reserve: async (_user: unknown, calls: number) => void reserved.push(calls) };
	return { service: createCompetitorInfoService({ places, usage }), detailsCalls, reserved };
};

const seedSources = async (location: ILocation) => {
	await Location.updateOne(
		{ _id: location._id },
		{ $set: { competitor_suggestions: { generated_at: new Date(), keywords_version: 1, keywords_used: [], api_calls: 1, results: [{ place_id: COMPETITOR_1, name: 'Suggested One', address: '1 Cache St', best_position: 2, keywords: [] }] } } },
	);
	await RankRun.create({
		location_id: location._id,
		created_by: userId,
		trigger: 'manual',
		status: 'done',
		run_at: new Date('2026-09-20T03:00:00Z'),
		keywords_version: 1,
		keywords: ['plumber'],
		region: 'ca',
		config: { grid_size: 3, spacing_km: 1, tracker_offset_km: 0.5, radius_m: 5000, store_place_names: true },
		targets: [{ key: 'self', place_id: SELF_PLACE_ID }],
		mapList: [
			{ keyword: 'plumber', point: 'C', results: [{ rank: 3, place_id: COMPETITOR_1, name: 'Map One', address: '1 Map St', lat: 43.61, lng: -79.31, is_self: false, target_key: null }] },
			{ keyword: 'plumber', point: 'N', results: [{ rank: 5, place_id: COMPETITOR_2, name: 'Map Two', address: '2 Map St', lat: 43.62, lng: -79.32, is_self: false, target_key: null }] },
		],
	});
	return (await Location.findById(location._id)) as ILocation;
};

describe('competitor info (Phase 17)', () => {
	it('uses the suggestion cache, then the map lists, then one Place Details call for the rest', async () => {
		const location = await seedSources(await createLocation(userId));
		const { service, detailsCalls, reserved } = fakes();
		const { info, api_calls } = await service.resolve(location, [COMPETITOR_1, COMPETITOR_2, COMPETITOR_3], { userId: String(userId) });
		expect(info).toEqual([
			// the cache gave the name and address; the map list only the missing position
			{ place_id: COMPETITOR_1, name: 'Suggested One', address: '1 Cache St', lat: 43.61, lng: -79.31 },
			{ place_id: COMPETITOR_2, name: 'Map Two', address: '2 Map St', lat: 43.62, lng: -79.32 },
			{ place_id: COMPETITOR_3, name: 'Details 3', address: '9 Details Rd', lat: 43.7, lng: -79.4 },
		]);
		expect(detailsCalls).toEqual([COMPETITOR_3]);
		expect(reserved).toEqual([1]);
		expect(api_calls).toBe(1);
	});

	it('makes no Google call without a user (GET) and keeps stored entries', async () => {
		const location = await seedSources(await createLocation(userId));
		const { service, detailsCalls } = fakes();
		const stored = [{ place_id: COMPETITOR_3, name: 'Stored Three', address: null, lat: 1, lng: 2 }];
		const { info } = await service.resolve(location, [COMPETITOR_3, 'ChIJunknownCompetitor0009'], { stored });
		expect(info).toEqual([stored[0], { place_id: 'ChIJunknownCompetitor0009', name: null, address: null, lat: null, lng: null }]);
		expect(detailsCalls).toEqual([]);
	});

	it('a Details failure leaves the fields null and stops further calls', async () => {
		const location = await createLocation(userId);
		const { service, detailsCalls } = fakes(new PlacesConfigError('GOOGLE_PLACE_API_KEY not set'));
		const { info } = await service.resolve(location, [COMPETITOR_1, COMPETITOR_2], { userId: String(userId) });
		expect(info.map((c) => c.name)).toEqual([null, null]);
		expect(detailsCalls).toEqual([COMPETITOR_1]);
	});

	it('PUT tracking stores the details, drops removed competitors and snapshots names', async () => {
		const location = await seedSources(await createLocation(userId));
		const { service } = fakes();
		const saved = await updateTracking(location, { competitors: [COMPETITOR_1, COMPETITOR_3] }, new Date(), { userId: String(userId), competitorInfo: service });
		expect(saved.competitors.map((c) => c.name)).toEqual(['Suggested One', 'Details 3']);
		let stored = (await Location.findById(location._id).lean())?.tracking?.competitor_info;
		expect(stored?.map((c) => c.place_id)).toEqual([COMPETITOR_1, COMPETITOR_3]);
		await updateTracking((await Location.findById(location._id)) as ILocation, { competitors: [COMPETITOR_3] }, new Date(), { userId: String(userId), competitorInfo: service });
		stored = (await Location.findById(location._id).lean())?.tracking?.competitor_info;
		expect(stored).toEqual([{ place_id: COMPETITOR_3, name: 'Details 3', address: '9 Details Rd', lat: 43.7, lng: -79.4 }]);
	});
});
