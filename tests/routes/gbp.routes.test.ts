import express from 'express';
import request from 'supertest';
import { Types } from 'mongoose';
import { GbpAccount, GbpLocation, RawAccountsPage, RawLocation, RawLocationsPage } from '../../src/clients/types/gbp';
import { queryTypesArr, tokenTypes } from '../../src/configs/constantTypes';
import { OAuthState, User, UserAuth, UserGBP } from '../../src/models';
import { isEncrypted } from '../../src/utils/tokenCrypto';
import { apiErrorHandler, getQueryParams } from '../../src/utils';
import { loadGbpFixture } from '../helpers/fakeTransport';
import { clearDb, createLocation, createUser, startTestDb } from '../helpers/mongoose';

// Routers pull in services that import mongoConnection and the real agenda: replace both.
jest.mock('../../src/configs/mongoConnection', () => ({ agenda: {} }));
const cancelMock = jest.fn(async () => 0);
jest.mock('../../src/configs/agenda', () => ({ getAgenda: () => ({ cancel: cancelMock, schedule: jest.fn() }), stopAgenda: jest.fn() }));

// C22: discovery must never call Places. Both the legacy helper and the new client are watched.
const legacyPlaceDetails = jest.fn();
jest.mock('../../src/helpers', () => ({ ...jest.requireActual('../../src/helpers'), fetchNAPDatFromGoogle: legacyPlaceDetails }));
const placesCalls = jest.fn();
jest.mock('../../src/clients/placesClient', () => {
	const actual = jest.requireActual('../../src/clients/placesClient');
	return { ...actual, placesClient: new Proxy({}, { get: () => placesCalls }) };
});

// The Google side of GBP, faked at the client boundary (no network).
const fake = {
	accounts: [] as GbpAccount[],
	locations: [] as GbpLocation[],
	location: null as GbpLocation | null,
	revoked: [] as string[],
};
jest.mock('../../src/clients/gbpClient', () => {
	const actual = jest.requireActual('../../src/clients/gbpClient');
	return {
		...actual,
		gbpClient: {
			exchangeCode: async () => ({
				accessToken: 'ya29.FAKE-route',
				refreshToken: '1//FAKE-route',
				expiryDate: new Date(Date.now() + 3600_000),
				scope: 'https://www.googleapis.com/auth/business.manage',
			}),
			// Like the real client: no stored GBP token means "not connected".
			listAccounts: async (userId: unknown) => {
				const { UserAuth: tokensModel } = jest.requireActual('../../src/models');
				if (!(await tokensModel.exists({ user_id: userId, token_type: 'GBP' }))) throw new actual.GbpNotConnectedError();
				return fake.accounts;
			},
			listLocations: async () => fake.locations,
			getLocation: async () => fake.location,
			revoke: async (token: string) => void fake.revoked.push(token),
			getAccessToken: async () => 'ya29.FAKE-route',
		},
	};
});

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const { mapAccount, mapLocation } = require('../../src/clients/gbpClient');
const gbpRoute = require('../../src/routes/v1/common/gbpPostSchedular.route').default;
const userAuthRoute = require('../../src/routes/v1/user/userAuth.route').default;
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

const app = express();
app.use(express.json());
app.use(getQueryParams(queryTypesArr));
app.use('/api/v1/gbp', gbpRoute);
app.use('/api/v1/user/auth', userAuthRoute);
app.use(apiErrorHandler);

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
	await Promise.all([UserAuth.syncIndexes(), UserGBP.syncIndexes(), OAuthState.syncIndexes()]);
	fake.accounts = (loadGbpFixture<RawAccountsPage>('accounts_p1').accounts ?? []).map(mapAccount);
	fake.locations = (loadGbpFixture<RawLocationsPage>('locations_p1').locations ?? []).map(mapLocation);
	fake.location = mapLocation(loadGbpFixture<RawLocation>('location'));
}, 60000);
afterAll(async () => db.stop());
beforeEach(async () => {
	await clearDb();
	fake.revoked = [];
	legacyPlaceDetails.mockClear();
	placesCalls.mockClear();
});

/** Runs the real connect flow: auth URL → callback with its state. */
const connect = async (token: string): Promise<void> => {
	const urlRes = await request(app).get('/api/v1/user/auth/google/gbp').set(auth(token));
	const state = new URL(urlRes.body.data).searchParams.get('state');
	const cb = await request(app).get('/api/v1/user/auth/google/gbp/callback').query({ code: '4/FAKE', state });
	expect(cb.status).toBe(200);
};

describe('GBP routes: auth', () => {
	it('401 without a token on every protected GBP route', async () => {
		const calls = [
			request(app).get('/api/v1/gbp'),
			request(app).post('/api/v1/gbp/bind-with-user').send({}),
			request(app).post('/api/v1/gbp/unbind').send({}),
			request(app).get('/api/v1/user/auth/google/gbp'),
			request(app).post('/api/v1/user/auth/google/gbp/revoke'),
		];
		for (const res of await Promise.all(calls)) expect(res.status).toBe(401);
	});
});

describe('GBP routes: connect', () => {
	it('returns a consent URL with business.manage only and a stored state', async () => {
		const { token } = await createUser('a@test.dev');
		const res = await request(app).get('/api/v1/user/auth/google/gbp').set(auth(token));
		expect(res.status).toBe(200);
		const url = new URL(res.body.data);
		expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/business.manage');
		expect(await OAuthState.countDocuments({})).toBe(1);
	});

	it('the callback connects with a valid state (no login needed) and stores encrypted tokens', async () => {
		const { user, token } = await createUser('b@test.dev');
		await connect(token);
		const row = await UserAuth.findOne({ user_id: user._id, token_type: tokenTypes.GBP }).lean();
		expect(isEncrypted(row?.access_token) && isEncrypted(row?.refresh_token)).toBe(true);
		expect(row?.expiry_date).toBeInstanceOf(Date);
		expect((await User.findById(user._id))?.is_gbp_connected).toBe(true);
	});

	it('the callback rejects a forged or reused state', async () => {
		const { user, token } = await createUser('c@test.dev');
		const forged = JSON.stringify({ user_id: String(user._id) });
		const res = await request(app).get('/api/v1/user/auth/google/gbp/callback').query({ code: '4/FAKE', state: forged });
		expect(res.status).toBe(400);
		const urlRes = await request(app).get('/api/v1/user/auth/google/gbp').set(auth(token));
		const state = new URL(urlRes.body.data).searchParams.get('state');
		expect((await request(app).get('/api/v1/user/auth/google/gbp/callback').query({ code: '4/FAKE', state })).status).toBe(200);
		expect((await request(app).get('/api/v1/user/auth/google/gbp/callback').query({ code: '4/FAKE', state })).status).toBe(400);
	});
});

describe('GBP routes: discovery, bind, unbind, disconnect', () => {
	it('GET /gbp lists locations from Business Information only (C22: no Places calls)', async () => {
		const { token } = await createUser('d@test.dev');
		await connect(token);
		const res = await request(app).get('/api/v1/gbp').set(auth(token));
		expect(res.status).toBe(200);
		expect(res.body.data.accounts).toBe(2);
		expect(res.body.data.errors).toEqual([]);
		expect(res.body.data.locations).toHaveLength(2); // same 2 locations under both accounts, listed once
		expect(res.body.data.locations[0]).toMatchObject({
			address: '100 Example St, Suite 5, Dallas, TX 75201',
			place_id: 'ChIJfakeGbpPlace000000001',
		});
		expect(legacyPlaceDetails).not.toHaveBeenCalled();
		expect(placesCalls).not.toHaveBeenCalled();
	});

	it('GET /gbp before connecting explains what to do', async () => {
		const { token } = await createUser('e@test.dev');
		const res = await request(app).get('/api/v1/gbp').set(auth(token));
		expect(res.status).toBe(400);
		expect(res.body.message).toBe('Please connect with Google Business Profile');
	});

	it('bind → unbind round trip', async () => {
		const { user, token } = await createUser('f@test.dev');
		const location = await createLocation(user._id as Types.ObjectId, { place_id: null });
		await connect(token);
		const body = { location_id: String(location._id), gbpAccountId: 'accounts/100000000000000000001', gbpLocationId: 'locations/200000000000000000001' };

		const bound = await request(app).post('/api/v1/gbp/bind-with-user').set(auth(token)).send(body);
		expect(bound.status).toBe(200);
		expect(bound.body.data.place_id).toEqual({ location: 'ChIJfakeGbpPlace000000001', gbp: 'ChIJfakeGbpPlace000000001', status: 'set' });

		const unbound = await request(app).post('/api/v1/gbp/unbind').set(auth(token)).send({ location_id: String(location._id) });
		expect(unbound.status).toBe(200);
		expect(unbound.body.data).toMatchObject({ unbound: true, tokens_deleted: true });
		expect(cancelMock).toHaveBeenCalled();
		expect((await request(app).post('/api/v1/gbp/unbind').set(auth(token)).send({ location_id: String(location._id) })).status).toBe(404);
	});

	it('bind validates input and requires a connection', async () => {
		const { user, token } = await createUser('g@test.dev');
		const location = await createLocation(user._id as Types.ObjectId);
		const body = { location_id: String(location._id), gbpAccountId: 'accounts/1', gbpLocationId: 'locations/2' };
		expect((await request(app).post('/api/v1/gbp/bind-with-user').set(auth(token)).send(body)).body.message).toBe('Please connect GBP first');
		await connect(token);
		expect((await request(app).post('/api/v1/gbp/bind-with-user').set(auth(token)).send({ ...body, gbpLocationId: 'x' })).status).toBe(400);
		expect((await request(app).post('/api/v1/gbp/bind-with-user').set(auth(token)).send({ location_id: 'nope' })).status).toBe(400);
		expect((await request(app).post('/api/v1/gbp/unbind').set(auth(token)).send({ location_id: 'nope' })).status).toBe(400);
	});

	it('disconnect revokes and removes the connection', async () => {
		const { user, token } = await createUser('h@test.dev');
		await connect(token);
		const res = await request(app).post('/api/v1/user/auth/google/gbp/revoke').set(auth(token));
		expect(res.status).toBe(200);
		expect(res.body.data).toEqual({ revoked: true, bindings_removed: 0 });
		expect(fake.revoked).toEqual(['1//FAKE-route']);
		expect(await UserAuth.countDocuments({ user_id: user._id })).toBe(0);
	});
});
