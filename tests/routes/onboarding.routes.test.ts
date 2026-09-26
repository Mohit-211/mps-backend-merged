import express from 'express';
import request from 'supertest';
import { Types } from 'mongoose';
import { GbpLocation, RawLocation } from '../../src/clients/types/gbp';
import { queryTypesArr } from '../../src/configs/constantTypes';
import { Location, OAuthState, PlacesUsage, RankRun, UserAuth, UserGBP } from '../../src/models';
import { apiErrorHandler, getQueryParams } from '../../src/utils';
import { loadGbpFixture } from '../helpers/fakeTransport';
import { clearDb, createLocation, createUser, keywordsOf, startTestDb } from '../helpers/mongoose';

// Routers import mongoConnection and the real agenda: replace both (schedule records rank-run jobs).
jest.mock('../../src/configs/mongoConnection', () => ({ agenda: {} }));
const scheduleMock = jest.fn(async () => ({}));
jest.mock('../../src/configs/agenda', () => ({ getAgenda: () => ({ schedule: scheduleMock, cancel: jest.fn(async () => 0) }), stopAgenda: jest.fn() }));
jest.mock('../../src/services/gbp/idToken', () => ({
	...jest.requireActual('../../src/services/gbp/idToken'),
	verifyGoogleIdToken: async () => ({ sub: '100000000000000000001', email: 'owner@example.test' }),
}));

const fake = { profile: null as GbpLocation | null, exchangeRedirects: [] as (string | undefined)[], suggestCalls: 0, searchCalls: 0 };
jest.mock('../../src/clients/gbpClient', () => {
	const actual = jest.requireActual('../../src/clients/gbpClient');
	return {
		...actual,
		gbpClient: {
			exchangeCode: async (_code: string, redirectUri?: string) => {
				fake.exchangeRedirects.push(redirectUri);
				return { accessToken: 'ya29.FAKE', refreshToken: '1//FAKE', expiryDate: new Date(Date.now() + 3600_000), scope: 'openid email', idToken: 'x.y.z' };
			},
			getLocation: async () => fake.profile,
			listAccounts: async () => [],
			listLocations: async () => [],
			revoke: async () => undefined,
		},
	};
});
jest.mock('../../src/clients/placesClient', () => {
	const actual = jest.requireActual('../../src/clients/placesClient');
	const place = (n: number) => ({ id: `ChIJrouteSuggest0000000${n}`, name: `Rival ${n}`, address: `${n} Main St`, rating: 4.1, userRatingCount: 10 * n });
	return {
		...actual,
		placesClient: {
			searchTextForSuggestions: async () => {
				fake.suggestCalls += 1;
				return { places: [1, 2, 3].map(place), apiCalls: 1 };
			},
			searchTextIds: async () => {
				fake.searchCalls += 1;
				return { places: [{ id: 'ChIJrouteCity0000000001' }], pagesFetched: 1, apiCalls: 1, stoppedEarly: false };
			},
			getPlaceDetails: async () => ({ details: { location: { latitude: 45.96, longitude: -66.64 } }, apiCalls: 1 }),
			searchTextNamesAddresses: async () => {
				fake.searchCalls += 1;
				return { places: [{ id: 'ChIJrouteSearch000000001', name: 'Rival Search', address: '9 Elm St' }], apiCalls: 1 };
			},
		},
	};
});

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const { mapLocation } = require('../../src/clients/gbpClient');
const onboardingRoute = require('../../src/routes/v1/common/onboarding.route').default;
const placesRoute = require('../../src/routes/v1/common/places.route').default;
const rankingRoute = require('../../src/routes/v1/common/ranking.route').default;
const userAuthRoute = require('../../src/routes/v1/user/userAuth.route').default;
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

const app = express();
app.use(express.json());
app.use(getQueryParams(queryTypesArr));
app.use('/api/v1/onboarding', onboardingRoute);
app.use('/api/v1/places', placesRoute);
app.use('/api/v1/locations', rankingRoute);
app.use('/api/v1/user/auth', userAuthRoute);
app.use(apiErrorHandler);

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
	await Promise.all([UserAuth.syncIndexes(), UserGBP.syncIndexes(), OAuthState.syncIndexes(), PlacesUsage.syncIndexes(), RankRun.syncIndexes()]);
	fake.profile = mapLocation(loadGbpFixture<RawLocation>('location'));
}, 60000);
afterAll(async () => db.stop());
beforeEach(async () => {
	await clearDb();
	fake.exchangeRedirects = [];
	fake.suggestCalls = 0;
	fake.searchCalls = 0;
	scheduleMock.mockClear();
});

const connectViaPopup = async (token: string) => {
	const popup = await request(app).get('/api/v1/user/auth/google/gbp/popup').set(auth(token));
	expect(popup.status).toBe(200);
	return request(app).post('/api/v1/user/auth/google/gbp/code').set(auth(token)).send({ code: '4/FAKE', state: popup.body.data.state });
};

describe('auth on every 7a route', () => {
	it('401 without a token', async () => {
		const id = new Types.ObjectId().toHexString();
		const calls = [
			request(app).get('/api/v1/user/auth/google/gbp/popup'),
			request(app).post('/api/v1/user/auth/google/gbp/code').send({}),
			request(app).get('/api/v1/onboarding/state'),
			request(app).get('/api/v1/onboarding/gbp-profiles'),
			request(app).post('/api/v1/onboarding/select-profile').send({}),
			request(app).post('/api/v1/onboarding/complete').send({}),
			request(app).get(`/api/v1/locations/${id}/competitor-suggestions`),
			request(app).get(`/api/v1/places/search?q=abc&locationId=${id}`),
			request(app).put(`/api/v1/locations/${id}/center`).send({ query: 'Fredericton' }),
		];
		for (const res of await Promise.all(calls)) expect(res.status).toBe(401);
	});
});

describe('popup connect', () => {
	it('config → code connects with redirect_uri "postmessage" and reports the Google email', async () => {
		const { token } = await createUser('a@test.dev');
		const res = await connectViaPopup(token);
		expect(res.status).toBe(200);
		expect(res.body.data).toEqual({ connected: true, google_email: 'owner@example.test', google_sub: '100000000000000000001' });
		expect(fake.exchangeRedirects).toEqual(['postmessage']);
		const state = await request(app).get('/api/v1/onboarding/state').set(auth(token));
		expect(state.body.data.gbp).toEqual({
			connected: true,
			connections: [{ google_sub: '100000000000000000001', google_email: 'owner@example.test', status: 'active' }],
		});
	});

	it("rejects a bogus state and another user's state", async () => {
		const { token } = await createUser('a@test.dev');
		const { token: other } = await createUser('b@test.dev');
		expect((await request(app).post('/api/v1/user/auth/google/gbp/code').set(auth(token)).send({ code: 'x', state: 'bogus' })).status).toBe(400);
		const popup = await request(app).get('/api/v1/user/auth/google/gbp/popup').set(auth(token));
		const stolen = await request(app).post('/api/v1/user/auth/google/gbp/code').set(auth(other)).send({ code: 'x', state: popup.body.data.state });
		expect(stolen.status).toBe(400);
	});
});

describe('onboarding flow over HTTP', () => {
	it('select-profile → keywords → suggestions → manual search → competitors → complete', async () => {
		const { token } = await createUser('flow@test.dev');
		await connectViaPopup(token);

		const selected = await request(app)
			.post('/api/v1/onboarding/select-profile')
			.set(auth(token))
			.send({ gbpAccountId: 'accounts/100000000000000000001', gbpLocationId: 'locations/200000000000000000001' });
		expect(selected.status).toBe(200);
		expect(selected.body.data.created).toBe(true);
		const locationId = selected.body.data.location.location_id as string;

		const kw = await request(app).put(`/api/v1/locations/${locationId}/tracking`).set(auth(token)).send({ keywords: ['plumber', 'emergency plumber'] });
		expect(kw.body.data.onboarding_step).toBe('keywords_set');

		const suggestions = await request(app).get(`/api/v1/locations/${locationId}/competitor-suggestions`).set(auth(token));
		expect(suggestions.status).toBe(200);
		expect(suggestions.body.data.suggestions).toHaveLength(3);
		expect(suggestions.body.data.cached).toBe(false);
		const cached = await request(app).get(`/api/v1/locations/${locationId}/competitor-suggestions`).set(auth(token));
		expect(cached.body.data.cached).toBe(true);

		const search = await request(app).get(`/api/v1/places/search?q=rival&locationId=${locationId}`).set(auth(token));
		expect(search.body.data).toEqual({ results: [{ place_id: 'ChIJrouteSearch000000001', name: 'Rival Search', address: '9 Elm St' }], api_calls: 1 });

		const comps = await request(app)
			.put(`/api/v1/locations/${locationId}/tracking`)
			.set(auth(token))
			.send({ competitors: [suggestions.body.data.suggestions[0].place_id, 'ChIJrouteSearch000000001'] });
		expect(comps.body.data.onboarding_step).toBe('competitors_set');

		const done = await request(app).post('/api/v1/onboarding/complete').set(auth(token)).send({ location_id: locationId });
		expect(done.status).toBe(200);
		expect(done.body.data.rank_run.status).toBe('queued');
		// The first rank run and the first GBP sync are queued; the monthly schedule is set.
		expect(scheduleMock.mock.calls.map((c) => (c as unknown[])[1]).sort()).toEqual(['gbp-sync', 'rank-run']);
		expect(done.body.data.gbp_sync).toMatchObject({ status: 'queued', existing: false });
		expect((await Location.findById(locationId))?.refresh?.next_refresh_at).toBeInstanceOf(Date);
		expect(fake.suggestCalls).toBe(2); // 2 keywords, then served from cache
		expect(fake.searchCalls).toBe(1);
	});

	it('enforces the daily Places limit (429)', async () => {
		const { user, token } = await createUser('cap@test.dev');
		const location = await createLocation(user._id as Types.ObjectId, { tracking: { keywords: keywordsOf('plumber') } });
		await PlacesUsage.create({ user_id: user._id, day: new Date().toISOString().slice(0, 10), calls: 50, expires_at: new Date(Date.now() + 86400000) });
		const res = await request(app).get(`/api/v1/places/search?q=rival&locationId=${location._id}`).set(auth(token));
		expect(res.status).toBe(429);
		expect(fake.searchCalls).toBe(0);
	});

	it("validates input and 404s another user's location", async () => {
		const { user: owner } = await createUser('owner@test.dev');
		const { token } = await createUser('intruder@test.dev');
		const theirs = await createLocation(owner._id as Types.ObjectId);
		expect((await request(app).get(`/api/v1/places/search?q=rival&locationId=${theirs._id}`).set(auth(token))).status).toBe(404);
		expect((await request(app).get(`/api/v1/locations/${theirs._id}/competitor-suggestions`).set(auth(token))).status).toBe(404);
		expect((await request(app).get(`/api/v1/places/search?q=r&locationId=${theirs._id}`).set(auth(token))).status).toBe(400);
		expect((await request(app).get('/api/v1/places/search?q=rival').set(auth(token))).status).toBe(400);
		expect((await request(app).post('/api/v1/onboarding/select-profile').set(auth(token)).send({ gbpAccountId: 'x', gbpLocationId: 'locations/1' })).status).toBe(400);
		expect((await request(app).post('/api/v1/onboarding/complete').set(auth(token)).send({ location_id: 'nope' })).status).toBe(400);
		expect((await request(app).post('/api/v1/onboarding/complete').set(auth(token)).send({ location_id: String(theirs._id) })).status).toBe(404);
	});

	it('PUT /center saves a manual center (2 Places calls) and validates input', async () => {
		const { user, token } = await createUser('center@test.dev');
		const { user: other } = await createUser('other@test.dev');
		const mine = await createLocation(user._id as Types.ObjectId, { lat: null, lng: null });
		const theirs = await createLocation(other._id as Types.ObjectId);
		expect((await request(app).put(`/api/v1/locations/${mine._id}/center`).set(auth(token)).send({ query: 'x' })).status).toBe(400);
		expect((await request(app).put(`/api/v1/locations/${theirs._id}/center`).set(auth(token)).send({ query: 'Fredericton' })).status).toBe(404);
		const res = await request(app).put(`/api/v1/locations/${mine._id}/center`).set(auth(token)).send({ query: 'Fredericton, NB' });
		expect(res.status).toBe(200);
		expect(res.body.data).toEqual({ lat: 45.96, lng: -66.64, center_source: 'manual', center_label: 'Fredericton, NB', api_calls: 2 });
		expect(fake.searchCalls).toBe(1);
		expect(await PlacesUsage.findOne({ user_id: user._id }).lean()).toMatchObject({ calls: 2 });
	});
});
