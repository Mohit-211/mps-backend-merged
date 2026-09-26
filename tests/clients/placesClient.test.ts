import logger from '../../src/configs/logger';
import {
	IDS_ONLY_FIELD_MASK,
	NAMES_ADDRESSES_FIELD_MASK,
	PlacesApiError,
	SUGGESTIONS_FIELD_MASK,
	PlacesConfigError,
	WITH_NAMES_FIELD_MASK,
	assertExactMask,
	assertIdsOnlyMask,
	createPlacesClient,
	placesClient,
} from '../../src/clients/placesClient';
import { PlaceDetailsField, SearchTextIdsParams } from '../../src/clients/types/places';
import { FakeStep, createFakeTransport, placeIds } from '../helpers/fakeTransport';

const SENTINEL_KEY = 'TEST_KEY_SENTINEL_places_do_not_leak';
const noSleep = async (): Promise<void> => undefined;

const baseParams: SearchTextIdsParams = {
	textQuery: 'emergency plumber',
	regionCode: 'ca',
	center: { latitude: 43.6629, longitude: -79.3347 },
};

const rankOf = (ids: { id: string; movedPlaceId?: string }[], target: string): number | null => {
	const index = ids.findIndex((p) => p.id === target || p.movedPlaceId === target);
	return index === -1 ? null : index + 1;
};

const clientWith = (steps: FakeStep[], apiKey: string = SENTINEL_KEY) => {
	const fake = createFakeTransport(steps);
	const client = createPlacesClient({ apiKey, transport: fake.transport, sleep: noSleep, defaultRadiusM: 5000 });
	return { client, fake };
};

describe('placesClient.searchTextIds', () => {
	it('finds the target on page 1 and stops (1 call)', async () => {
		const { client, fake } = clientWith([{ status: 200, fixture: 'searchText_p1_target' }]);
		const result = await client.searchTextIds({ ...baseParams, stopWhenFound: [placeIds.target] });
		expect(rankOf(result.places, placeIds.target)).toBe(4);
		expect(result).toMatchObject({ pagesFetched: 1, apiCalls: 1, stoppedEarly: true });
		expect(fake.requests).toHaveLength(1);
	});

	it('sends the IDs-only mask, the key only as a header, and the documented body', async () => {
		const { client, fake } = clientWith([{ status: 200, fixture: 'searchText_p1_target' }]);
		await client.searchTextIds({ ...baseParams, stopWhenFound: [placeIds.target] });
		const [request] = fake.requests;
		expect(request.method).toBe('POST');
		expect(request.url).toBe('https://places.googleapis.com/v1/places:searchText');
		expect(request.url).not.toContain(SENTINEL_KEY);
		expect(request.headers['X-Goog-FieldMask']).toBe('places.id,places.movedPlaceId,nextPageToken');
		expect(request.headers['X-Goog-Api-Key']).toBe(SENTINEL_KEY);
		expect(request.data).toEqual({
			textQuery: 'emergency plumber',
			regionCode: 'ca',
			pageSize: 20,
			locationBias: { circle: { center: { latitude: 43.6629, longitude: -79.3347 }, radius: 5000 } },
		});
	});

	it('finds the target on page 3 at rank 47 (3 calls, page tokens forwarded with identical params)', async () => {
		const { client, fake } = clientWith([
			{ status: 200, fixture: 'searchText_p1_filler' },
			{ status: 200, fixture: 'searchText_p2_filler' },
			{ status: 200, fixture: 'searchText_p3_target' },
		]);
		const result = await client.searchTextIds({ ...baseParams, stopWhenFound: [placeIds.target] });
		expect(rankOf(result.places, placeIds.target)).toBe(47);
		expect(result).toMatchObject({ pagesFetched: 3, apiCalls: 3, stoppedEarly: false });
		const bodies = fake.requests.map((r) => r.data as Record<string, unknown>);
		expect(bodies[0].pageToken).toBeUndefined();
		expect(bodies[1].pageToken).toBe('AUacShh1-page2');
		expect(bodies[2].pageToken).toBe('AUacShh1-page3');
		const withoutToken = bodies.map(({ pageToken: _token, ...rest }) => rest);
		expect(withoutToken[1]).toEqual(withoutToken[0]);
		expect(withoutToken[2]).toEqual(withoutToken[0]);
	});

	it('returns 60 results without the target when it is not ranked (60+)', async () => {
		const { client } = clientWith([
			{ status: 200, fixture: 'searchText_p1_filler' },
			{ status: 200, fixture: 'searchText_p2_filler' },
			{ status: 200, fixture: 'searchText_p3_filler' },
		]);
		const result = await client.searchTextIds({ ...baseParams, stopWhenFound: [placeIds.target] });
		expect(result.places).toHaveLength(60);
		expect(rankOf(result.places, placeIds.target)).toBeNull();
		expect(result).toMatchObject({ pagesFetched: 3, apiCalls: 3, stoppedEarly: false });
	});

	it('with several stopWhenFound IDs, pages until all are seen, then stops', async () => {
		const { client, fake } = clientWith([
			{ status: 200, fixture: 'searchText_p1_target' },
			{ status: 200, fixture: 'searchText_p2_filler' },
		]);
		const result = await client.searchTextIds({ ...baseParams, stopWhenFound: [placeIds.target, placeIds.competitor] });
		expect(rankOf(result.places, placeIds.target)).toBe(4);
		expect(rankOf(result.places, placeIds.competitor)).toBe(26);
		expect(result).toMatchObject({ pagesFetched: 2, apiCalls: 2, stoppedEarly: true });
		expect(fake.remaining()).toBe(0);
	});

	it('without stopWhenFound, fetches every available page', async () => {
		const { client } = clientWith([
			{ status: 200, fixture: 'searchText_p1_target' },
			{ status: 200, fixture: 'searchText_p2_filler' },
			{ status: 200, fixture: 'searchText_p3_filler' },
		]);
		const result = await client.searchTextIds(baseParams);
		expect(result).toMatchObject({ pagesFetched: 3, apiCalls: 3 });
		expect(result.places).toHaveLength(60);
	});

	it('respects maxPages', async () => {
		const { client, fake } = clientWith([{ status: 200, fixture: 'searchText_p1_filler' }]);
		const result = await client.searchTextIds({ ...baseParams, maxPages: 1, stopWhenFound: [placeIds.target] });
		expect(result).toMatchObject({ pagesFetched: 1, apiCalls: 1, stoppedEarly: false });
		expect(fake.requests).toHaveLength(1);
	});

	it('honours movedPlaceId: an old listing that moved to the target counts as the target', async () => {
		const { client } = clientWith([{ status: 200, fixture: 'searchText_moved' }]);
		const result = await client.searchTextIds({ ...baseParams, stopWhenFound: [placeIds.target] });
		expect(result.places[1]).toEqual({ id: placeIds.movedFrom, movedPlaceId: placeIds.target });
		expect(rankOf(result.places, placeIds.target)).toBe(2);
		expect(result.stoppedEarly).toBe(false);
	});

	it('retries once after an API error and succeeds (2 calls)', async () => {
		const { client } = clientWith([
			{ status: 500, fixture: 'error_500' },
			{ status: 200, fixture: 'searchText_p1_target' },
		]);
		const result = await client.searchTextIds({ ...baseParams, stopWhenFound: [placeIds.target] });
		expect(rankOf(result.places, placeIds.target)).toBe(4);
		expect(result).toMatchObject({ pagesFetched: 1, apiCalls: 2 });
	});

	it('retries a timeout once', async () => {
		const { client } = clientWith([{ networkError: 'TIMEOUT' }, { status: 200, fixture: 'searchText_p1_target' }]);
		const result = await client.searchTextIds({ ...baseParams, stopWhenFound: [placeIds.target] });
		expect(result.apiCalls).toBe(2);
	});

	it('throws PlacesApiError after two failures (the engine maps this to status "error")', async () => {
		const { client } = clientWith([
			{ status: 429, fixture: 'error_429' },
			{ status: 429, fixture: 'error_429' },
		]);
		const promise = client.searchTextIds({ ...baseParams, stopWhenFound: [placeIds.target] });
		await expect(promise).rejects.toBeInstanceOf(PlacesApiError);
		await expect(promise).rejects.toMatchObject({ status: 429, apiStatus: 'RESOURCE_EXHAUSTED', apiCalls: 2 });
	});

	it('counts calls from earlier pages when a later page fails', async () => {
		const { client } = clientWith([
			{ status: 200, fixture: 'searchText_p1_filler' },
			{ status: 500, fixture: 'error_500' },
			{ status: 500, fixture: 'error_500' },
		]);
		await expect(client.searchTextIds({ ...baseParams, stopWhenFound: [placeIds.target] })).rejects.toMatchObject({
			apiCalls: 3,
		});
	});

	it('does not retry a 400', async () => {
		const { client, fake } = clientWith([{ status: 400, fixture: 'error_400' }]);
		await expect(client.searchTextIds(baseParams)).rejects.toMatchObject({ status: 400, apiCalls: 1 });
		expect(fake.requests).toHaveLength(1);
	});

	it('throws "GOOGLE_PLACE_API_KEY not set" before any request when the key is missing', async () => {
		const { client, fake } = clientWith([], '');
		await expect(client.searchTextIds(baseParams)).rejects.toThrow(new PlacesConfigError('GOOGLE_PLACE_API_KEY not set'));
		await expect(client.searchTextWithNames(baseParams)).rejects.toBeInstanceOf(PlacesConfigError);
		await expect(client.getPlaceDetails(placeIds.target, ['location'])).rejects.toBeInstanceOf(PlacesConfigError);
		expect(fake.requests).toHaveLength(0);
	});

	it('the default client has no key in tests and refuses to call Google', async () => {
		await expect(placesClient.searchTextIds(baseParams)).rejects.toThrow('GOOGLE_PLACE_API_KEY not set');
	});

	it('rejects invalid input', async () => {
		const { client } = clientWith([]);
		await expect(client.searchTextIds({ ...baseParams, textQuery: ' ' })).rejects.toThrow('textQuery');
		await expect(client.searchTextIds({ ...baseParams, regionCode: 'usa' })).rejects.toThrow('regionCode');
		await expect(client.searchTextIds({ ...baseParams, center: { latitude: 91, longitude: 0 } })).rejects.toThrow('center');
		await expect(client.searchTextIds({ ...baseParams, maxPages: 4 })).rejects.toThrow('maxPages');
	});
});

describe('IDs-only field mask guard', () => {
	it('accepts exactly the IDs-only fields (any order)', () => {
		expect(() => assertIdsOnlyMask(IDS_ONLY_FIELD_MASK)).not.toThrow();
		expect(() => assertIdsOnlyMask('nextPageToken,places.movedPlaceId,places.id')).not.toThrow();
	});

	it.each([
		'places.id,places.movedPlaceId,places.displayName,nextPageToken',
		'places.id,places.movedPlaceId',
		'places.id,places.movedPlaceId,nextPageToken,nextPageToken',
		'*',
		'places.*',
	])('rejects "%s"', (mask) => {
		expect(() => assertIdsOnlyMask(mask)).toThrow('IDs-only field mask violated');
	});
});

describe('placesClient.searchTextWithNames', () => {
	it('fetches exactly one page with the names mask and maps displayName', async () => {
		const { client, fake } = clientWith([{ status: 200, fixture: 'searchText_names_p1' }]);
		const result = await client.searchTextWithNames(baseParams);
		expect(fake.requests).toHaveLength(1);
		expect(fake.requests[0].headers['X-Goog-FieldMask']).toBe(WITH_NAMES_FIELD_MASK);
		expect(result.apiCalls).toBe(1);
		expect(result.places).toHaveLength(20);
		expect(result.places[1]).toEqual({ id: placeIds.target, name: 'Maple Leaf Plumbing & Heating' });
	});
});

describe('placesClient.getPlaceDetails', () => {
	it('GETs the place with the fields as the mask and maps the location', async () => {
		const { client, fake } = clientWith([{ status: 200, fixture: 'placeDetails_location' }]);
		const result = await client.getPlaceDetails(`places/${placeIds.target}`, ['location', 'displayName']);
		expect(fake.requests[0]).toMatchObject({
			method: 'GET',
			url: `https://places.googleapis.com/v1/places/${placeIds.target}`,
		});
		expect(fake.requests[0].headers['X-Goog-FieldMask']).toBe('location,displayName');
		expect(result).toEqual({
			details: expect.objectContaining({
				id: placeIds.target,
				displayName: 'Maple Leaf Plumbing & Heating',
				location: { latitude: 43.6629, longitude: -79.3347 },
			}),
			apiCalls: 1,
		});
	});

	it.each(['places.location', '*', 'location,rating', ''])('rejects the field "%s"', async (field) => {
		const { client, fake } = clientWith([]);
		await expect(client.getPlaceDetails(placeIds.target, [field as PlaceDetailsField])).rejects.toThrow(
			'Invalid Place Details field',
		);
		expect(fake.requests).toHaveLength(0);
	});
});

describe('call accounting and secrecy', () => {
	it('tracks calls per SKU, including retries', async () => {
		const { client } = clientWith([
			{ status: 503, body: { error: { code: 503, status: 'UNAVAILABLE', message: 'unavailable' } } },
			{ status: 200, fixture: 'searchText_p1_target' },
			{ status: 200, fixture: 'searchText_names_p1' },
			{ status: 200, fixture: 'placeDetails_location' },
		]);
		await client.searchTextIds({ ...baseParams, stopWhenFound: [placeIds.target] });
		await client.searchTextWithNames(baseParams);
		await client.getPlaceDetails(placeIds.target, ['location']);
		expect(client.getStats()).toEqual({ ids_only: 2, pro: 1, enterprise: 0, details: 1 });
	});

	it('never puts the API key in logs or errors', async () => {
		const logged: string[] = [];
		for (const level of ['debug', 'info', 'warn', 'error'] as const) {
			jest.spyOn(logger, level).mockImplementation(((...args: unknown[]) => {
				logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
				return logger;
			}) as never);
		}
		const { client } = clientWith([
			{ status: 200, fixture: 'searchText_p1_filler' },
			{ status: 500, fixture: 'error_500' },
			{ status: 500, fixture: 'error_500' },
		]);
		const error = await client.searchTextIds(baseParams).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(PlacesApiError);
		expect(logged.length).toBeGreaterThan(0);
		const everything = logged.join('\n') + JSON.stringify(error) + String(error) + ((error as Error).stack ?? '');
		expect(everything).not.toContain(SENTINEL_KEY);
		expect(everything).not.toContain('emergency plumber');
	});
});

describe('competitor search variants (Phase 7a)', () => {
	it('suggestions: one page with names, addresses, rating and count, on its own mask', async () => {
		const { client, fake } = clientWith([{ status: 200, fixture: 'searchText_suggestions_kw1' }]);
		const result = await client.searchTextForSuggestions(baseParams);
		expect(result.apiCalls).toBe(1);
		expect(result.places).toHaveLength(20);
		expect(result.places[0]).toEqual({
			id: 'ChIJsuggestTest0000000001',
			name: 'Leslieville Plumbing',
			address: '101 King St W, Toronto, ON M4M 1A1, Canada',
			rating: 4,
			userRatingCount: 47,
		});
		expect(fake.requests[0].headers['X-Goog-FieldMask']).toBe(SUGGESTIONS_FIELD_MASK);
		expect((fake.requests[0].data as { pageSize: number }).pageSize).toBe(20);
		expect(client.getStats()).toEqual({ ids_only: 0, pro: 0, enterprise: 1, details: 0 });
	});

	it('suggestions keep movedPlaceId and null rating when Google omits it', async () => {
		const { client } = clientWith([{ status: 200, fixture: 'searchText_suggestions_kw2' }]);
		const { places } = await client.searchTextForSuggestions(baseParams);
		expect(places.find((p) => p.id === 'ChIJoldSelfListing0000001')?.movedPlaceId).toBe('ChIJselfTestPlaceId000001');
		expect(places.find((p) => p.id === 'ChIJsuggestTest0000000021')).toMatchObject({ rating: null, userRatingCount: null });
	});

	it('manual search: at most 10 names + addresses on the Pro mask', async () => {
		const { client, fake } = clientWith([{ status: 200, fixture: 'searchText_names_addresses' }]);
		const { places, apiCalls } = await client.searchTextNamesAddresses(baseParams);
		expect(apiCalls).toBe(1);
		expect(places).toHaveLength(10);
		expect(places[0]).toEqual({ id: 'ChIJsuggestTest0000000100', name: 'Dallas Plumbing Result 1', address: '200 Main St, Dallas, TX 75201, USA' });
		expect(fake.requests[0].headers['X-Goog-FieldMask']).toBe(NAMES_ADDRESSES_FIELD_MASK);
		expect((fake.requests[0].data as { pageSize: number }).pageSize).toBe(10);
		expect(client.getStats().pro).toBe(1);
	});

	it('mask guards reject any extra or missing field', () => {
		expect(() => assertExactMask(`${SUGGESTIONS_FIELD_MASK},places.reviews`, SUGGESTIONS_FIELD_MASK)).toThrow(/Field mask violated/);
		expect(() => assertExactMask('places.id,places.displayName', NAMES_ADDRESSES_FIELD_MASK)).toThrow(/Field mask violated/);
		expect(() => assertExactMask(NAMES_ADDRESSES_FIELD_MASK, NAMES_ADDRESSES_FIELD_MASK)).not.toThrow();
	});

	it('the new masks never reach the IDs-only ranking search', async () => {
		const { client, fake } = clientWith([
			{ status: 200, fixture: 'searchText_suggestions_kw1' },
			{ status: 200, fixture: 'searchText_names_addresses' },
			{ status: 200, fixture: 'searchText_p1_target' },
		]);
		await client.searchTextForSuggestions(baseParams);
		await client.searchTextNamesAddresses(baseParams);
		await client.searchTextIds({ ...baseParams, stopWhenFound: [placeIds.target] });
		expect(fake.requests[2].headers['X-Goog-FieldMask']).toBe(IDS_ONLY_FIELD_MASK);
		expect(() => assertIdsOnlyMask(SUGGESTIONS_FIELD_MASK)).toThrow();
		expect(() => assertIdsOnlyMask(NAMES_ADDRESSES_FIELD_MASK)).toThrow();
	});
});

