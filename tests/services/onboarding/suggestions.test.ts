import { Types } from 'mongoose';
import { PlacesApiError } from '../../../src/clients/placesClient';
import { HttpRequestError } from '../../../src/clients/http';
import { SearchTextParams, SearchTextSuggestionsResult, SuggestionPlace } from '../../../src/clients/types/places';
import { ILocation, Location } from '../../../src/models';
import { createSuggestionsService, mergeSuggestions } from '../../../src/services/onboarding/suggestions.service';
import { loadPlacesFixture } from '../../helpers/fakeTransport';
import { SELF_PLACE_ID, clearDb, createLocation, createUser, keywordsOf, startTestDb } from '../../helpers/mongoose';

jest.mock('../../../src/configs/mongoConnection', () => ({ agenda: {} }));

interface RawFixture {
	places: { id: string; movedPlaceId?: string; displayName?: { text: string }; formattedAddress?: string; rating?: number; userRatingCount?: number }[];
}
const toPlaces = (name: string): SuggestionPlace[] =>
	loadPlacesFixture<RawFixture>(name).places.map((p) => ({
		id: p.id,
		...(p.movedPlaceId ? { movedPlaceId: p.movedPlaceId } : {}),
		name: p.displayName?.text ?? null,
		address: p.formattedAddress ?? null,
		rating: p.rating ?? null,
		userRatingCount: p.userRatingCount ?? null,
	}));
const KW1 = toPlaces('searchText_suggestions_kw1');
const KW2 = toPlaces('searchText_suggestions_kw2');
const id = (n: number): string => `ChIJsuggestTest${String(n).padStart(10, '0')}`;

describe('mergeSuggestions', () => {
	it('excludes self (including a moved listing), dedupes and keeps the best position per business', () => {
		const merged = mergeSuggestions(
			[
				{ keyword: 'emergency plumber', places: KW1 },
				{ keyword: 'drain cleaning', places: KW2 },
			],
			SELF_PLACE_ID,
		);
		expect(merged).toHaveLength(10);
		expect(merged.some((s) => s.place_id === SELF_PLACE_ID || s.place_id === 'ChIJoldSelfListing0000001')).toBe(false);
		// Businesses 1 (#1, #2) and 5 (#6, #1) both have best position 1 across two keywords; the tie
		// goes to the higher review count (5: 75 vs 1: 47).
		expect(merged[0]).toMatchObject({
			place_id: id(5),
			best_position: 1,
			userRatingCount: 75,
			keywords: [
				{ keyword: 'emergency plumber', position: 6 },
				{ keyword: 'drain cleaning', position: 1 },
			],
		});
		expect(merged[1]).toMatchObject({ place_id: id(1), best_position: 1, userRatingCount: 47 });
		expect(new Set(merged.map((s) => s.place_id)).size).toBe(merged.length);
		expect(merged.map((s) => s.best_position)).toEqual([...merged.map((s) => s.best_position)].sort((a, b) => a - b));
	});

	it('breaks ties by number of keywords, then review count', () => {
		const p = (n: number, count: number | null): SuggestionPlace => ({ id: id(n), name: `B${n}`, address: null, rating: null, userRatingCount: count });
		const merged = mergeSuggestions(
			[
				{ keyword: 'a', places: [p(1, 5), p(2, 100)] },
				{ keyword: 'b', places: [p(3, 50), p(1, 5)] },
			],
			null,
		);
		expect(merged.map((s) => s.place_id)).toEqual([id(1), id(3), id(2)]);
	});

	it('fills missing details from a later keyword', () => {
		const merged = mergeSuggestions(
			[
				{ keyword: 'a', places: [{ id: id(1), name: 'X', address: null, rating: null, userRatingCount: null }] },
				{ keyword: 'b', places: [{ id: id(1), name: 'X', address: '1 Main St', rating: 4.5, userRatingCount: 30 }] },
			],
			null,
		);
		expect(merged[0]).toMatchObject({ address: '1 Main St', rating: 4.5, userRatingCount: 30 });
	});
});

describe('suggestions service', () => {
	let db: { stop: () => Promise<void> };
	beforeAll(async () => {
		db = await startTestDb();
	});
	afterAll(async () => db.stop());
	beforeEach(async () => clearDb());

	const setup = (opts: { now?: () => Date; env?: string; fail?: (keyword: string) => boolean } = {}) => {
		const calls: SearchTextParams[] = [];
		const reserved: number[] = [];
		const service = createSuggestionsService({
			places: {
				searchTextForSuggestions: async (params: SearchTextParams): Promise<SearchTextSuggestionsResult> => {
					calls.push(params);
					if (opts.fail?.(params.textQuery)) {
						throw new PlacesApiError(new HttpRequestError({ code: 'HTTP_ERROR', status: 500, message: 'x' }), 2);
					}
					return { places: params.textQuery === 'drain cleaning' ? KW2 : KW1, apiCalls: 1 };
				},
			},
			usage: { reserve: async (_u, n) => void reserved.push(n) },
			now: opts.now,
			env: opts.env ?? 'production',
		});
		return { service, calls, reserved };
	};

	const newLocation = async (userId: Types.ObjectId, competitors: string[] = []) =>
		createLocation(userId, { tracking: { keywords: keywordsOf('emergency plumber', 'drain cleaning', 'water heater repair'), keywords_version: 3, competitors } });

	it('searches each keyword at the center, returns the top 10 and caches them', async () => {
		const { user } = await createUser('u@test.dev');
		const location = await newLocation(user._id as Types.ObjectId, [id(5)]);
		const { service, calls, reserved } = setup();
		const result = await service.getSuggestions(location, user._id);
		expect(calls.map((c) => c.textQuery)).toEqual(['emergency plumber', 'drain cleaning', 'water heater repair']);
		expect(calls[0]).toMatchObject({ regionCode: 'ca', center: { latitude: 43.6629, longitude: -79.3347 } });
		expect(reserved).toEqual([3]);
		expect(result).toMatchObject({ cached: false, api_calls: 3, keywords_used: ['emergency plumber', 'drain cleaning', 'water heater repair'] });
		expect(result.suggestions).toHaveLength(10);
		expect(result.suggestions.find((s) => s.place_id === id(5))?.already_selected).toBe(true);
		const saved = await Location.findById(location._id).lean();
		expect(saved?.competitor_suggestions).toMatchObject({ keywords_version: 3, api_calls: 3 });
		expect(saved?.competitor_suggestions?.results).toHaveLength(10);
	});

	it('serves the cache for 24 h with the same keywords, refreshes on demand, on expiry or a keyword change', async () => {
		const { user } = await createUser('u@test.dev');
		await newLocation(user._id as Types.ObjectId);
		let now = new Date('2026-09-26T10:00:00Z');
		const { service, calls } = setup({ now: () => now });
		const reload = async () => (await Location.findOne({ created_by: user._id })) as ILocation;
		await service.getSuggestions(await reload(), user._id);
		expect((await service.getSuggestions(await reload(), user._id)).cached).toBe(true);
		expect(calls).toHaveLength(3);
		await service.getSuggestions(await reload(), user._id, { refresh: true });
		expect(calls).toHaveLength(6);
		now = new Date('2026-09-27T10:00:01Z');
		expect((await service.getSuggestions(await reload(), user._id)).cached).toBe(false);
		await Location.updateOne({ created_by: user._id }, { $set: { 'tracking.keywords_version': 4 } });
		expect((await service.getSuggestions(await reload(), user._id)).cached).toBe(false);
		expect(calls).toHaveLength(12);
	});

	it('caps keywords in development', async () => {
		const { user } = await createUser('u@test.dev');
		const location = await newLocation(user._id as Types.ObjectId);
		const { service, calls } = setup({ env: 'development' });
		expect((await service.getSuggestions(location, user._id)).keywords_used).toEqual(['emergency plumber', 'drain cleaning']);
		expect(calls).toHaveLength(2);
	});

	it('survives one failed keyword, fails (502) when all fail', async () => {
		const { user } = await createUser('u@test.dev');
		const location = await newLocation(user._id as Types.ObjectId);
		const partly = setup({ fail: (k) => k === 'drain cleaning' });
		expect((await partly.service.getSuggestions(location, user._id)).api_calls).toBe(1 + 2 + 1);
		const all = setup({ fail: () => true });
		await expect(all.service.getSuggestions(location, user._id, { refresh: true })).rejects.toMatchObject({ statusCode: 502 });
	});

	it('needs keywords and coordinates', async () => {
		const { user } = await createUser('u@test.dev');
		const noKeywords = await createLocation(user._id as Types.ObjectId);
		await expect(setup().service.getSuggestions(noKeywords, user._id)).rejects.toMatchObject({ statusCode: 400 });
		const noCenter = await createLocation(user._id as Types.ObjectId, { lat: null, lng: null, tracking: { keywords: keywordsOf('plumber') } });
		await expect(setup().service.getSuggestions(noCenter, user._id)).rejects.toMatchObject({ statusCode: 400 });
	});
});
