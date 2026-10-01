import express from 'express';
import request from 'supertest';
import { Types } from 'mongoose';
import { GbpAccount, GbpLocation, RawAccountsPage, RawLocation, RawLocationsPage } from '../../src/clients/types/gbp';
import config from '../../src/configs/config';
import { queryTypesArr, tokenTypes } from '../../src/configs/constantTypes';
import { OAuthState, User, UserAuth, UserGBP } from '../../src/models';
import { isEncrypted } from '../../src/utils/tokenCrypto';
import { apiErrorHandler, getQueryParams } from '../../src/utils';
import { loadGbpFixture } from '../helpers/fakeTransport';
import { clearDb, createUser, ensureOrg, startTestDb } from '../helpers/mongoose';

// Routers pull in services that import mongoConnection and the real agenda: replace both.
jest.mock('../../src/configs/mongoConnection', () => ({ agenda: {} }));
const cancelMock = jest.fn(async () => 0);
jest.mock('../../src/configs/agenda', () => ({ getAgenda: () => ({ cancel: cancelMock, schedule: jest.fn() }), stopAgenda: jest.fn() }));

// C22: discovery must never call Places (the legacy Place Details helper was deleted in the cleanup;
// the new Places client is watched).
const placesCalls = jest.fn();
jest.mock('../../src/clients/placesClient', () => {
	const actual = jest.requireActual('../../src/clients/placesClient');
	return { ...actual, placesClient: new Proxy({}, { get: () => placesCalls }) };
});

// id_token verification would fetch Google's certificates: replace it (it has its own tests).
jest.mock('../../src/services/gbp/idToken', () => ({
	...jest.requireActual('../../src/services/gbp/idToken'),
	verifyGoogleIdToken: async () => ({ sub: '100000000000000000001', email: 'owner@example.test' }),
}));

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
				scope: 'openid email https://www.googleapis.com/auth/business.manage',
				idToken: 'fake.id.token',
			}),
			// Like the real client: no stored GBP token means "not connected".
			listAccounts: async (conn: { userId: unknown }) => {
				const { UserAuth: tokensModel } = jest.requireActual('../../src/models');
				if (!(await tokensModel.exists({ user_id: conn.userId, token_type: 'GBP' }))) throw new actual.GbpNotConnectedError();
				return fake.accounts;
			},
			listLocations: async () => fake.locations,
			getLocation: async (_conn: unknown, name: string) => fake.locations.find((l) => l.name === name) ?? fake.location,
			revoke: async (token: string) => void fake.revoked.push(token),
			getAccessToken: async () => 'ya29.FAKE-route',
		},
	};
});

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const { mapAccount, mapLocation } = require('../../src/clients/gbpClient');
const gbpRoute = require('../../src/routes/v1/common/gbpPostSchedular.route').default;
const locationRoute = require('../../src/routes/v1/common/location.route').default;
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

const app = express();
app.use(express.json());
app.use(getQueryParams(queryTypesArr));
app.use('/api/v1/gbp', gbpRoute);
app.use('/api/v1/locations', locationRoute);
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
	placesCalls.mockClear();
});

/** Runs the real connect flow: auth URL → callback with its state. */
const connect = async (token: string): Promise<void> => {
	const urlRes = await request(app).get('/api/v1/gbp/connect/url').set(auth(token));
	const state = new URL(urlRes.body.data).searchParams.get('state');
	const cb = await request(app).get('/api/v1/gbp/connect/callback').query({ code: '4/FAKE', state });
	expect(resultOf(cb).status).toBe('success');
};

/** The redirect flow sends the browser to FRONTEND_URL/gbp/connect/callback?status=&message=. */
const resultOf = (res: request.Response): { status: string | null; message: string | null } => {
	expect(res.status).toBe(302);
	const to = new URL(res.headers.location);
	expect(`${to.origin}${to.pathname}`).toBe(`${config.auth.frontendUrl.replace(/\/+$/, '')}/gbp/connect/callback`);
	return { status: to.searchParams.get('status'), message: to.searchParams.get('message') };
};

describe('GBP routes: auth', () => {
	it('401 without a token on every protected GBP route', async () => {
		const calls = [
			request(app).get('/api/v1/gbp/connections'),
			request(app).put('/api/v1/gbp/connections/x/picks').send({ gbp_location_ids: [] }),
			request(app).post(`/api/v1/gbp/picks/${new Types.ObjectId().toHexString()}/bind`).send({}),
			request(app).delete(`/api/v1/gbp/picks/${new Types.ObjectId().toHexString()}`),
			request(app).post('/api/v1/gbp/unbind').send({}),
			request(app).get('/api/v1/gbp/connect/url'),
			request(app).post('/api/v1/gbp/disconnect'),
		];
		for (const res of await Promise.all(calls)) expect(res.status).toBe(401);
	});
});

describe('GBP routes: connect', () => {
	it('returns a consent URL with openid, email and business.manage and a stored state', async () => {
		const { token } = await createUser('a@test.dev');
		const res = await request(app).get('/api/v1/gbp/connect/url').set(auth(token));
		expect(res.status).toBe(200);
		const url = new URL(res.body.data);
		expect(url.searchParams.get('scope')).toBe('openid email https://www.googleapis.com/auth/business.manage');
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
		const res = await request(app).get('/api/v1/gbp/connect/callback').query({ code: '4/FAKE', state: forged });
		expect(resultOf(res)).toEqual({ status: 'error', message: expect.stringMatching(/invalid or has expired/) });
		const urlRes = await request(app).get('/api/v1/gbp/connect/url').set(auth(token));
		const state = new URL(urlRes.body.data).searchParams.get('state');
		const first = resultOf(await request(app).get('/api/v1/gbp/connect/callback').query({ code: '4/FAKE', state }));
		expect(first.status).toBe('success');
		expect(first.message).toMatch(/^Connected as /);
		expect(resultOf(await request(app).get('/api/v1/gbp/connect/callback').query({ code: '4/FAKE', state })).status).toBe('error');
		expect(await UserAuth.countDocuments({ user_id: user._id })).toBe(1);
	});

	it('the callback reports a declined consent as denied', async () => {
		const res = await request(app).get('/api/v1/gbp/connect/callback').query({ error: 'access_denied' });
		expect(resultOf(res)).toEqual({ status: 'denied', message: 'Google Business Profile access was not granted.' });
	});

	it('without FRONTEND_URL the callback answers JSON (200 / 400)', async () => {
		const saved = config.auth.frontendUrl;
		config.auth.frontendUrl = '';
		try {
			const { token } = await createUser('json@test.dev');
			const urlRes = await request(app).get('/api/v1/gbp/connect/url').set(auth(token));
			const state = new URL(urlRes.body.data).searchParams.get('state');
			const ok = await request(app).get('/api/v1/gbp/connect/callback').query({ code: '4/FAKE', state });
			expect(ok.status).toBe(200);
			expect(ok.body.data.connected).toBe(true);
			expect((await request(app).get('/api/v1/gbp/connect/callback').query({ code: '4/FAKE', state })).status).toBe(400);
		} finally {
			config.auth.frontendUrl = saved;
		}
	});
});

describe('GBP routes: connections, picks, bind, unbind, disconnect (2026-10-01)', () => {
	const SUB = '100000000000000000001';
	const owner = async (email: string) => {
		const created = await createUser(email);
		await ensureOrg(created.user._id);
		return created;
	};
	const pickAll = (token: string, ids: string[]) => request(app).put(`/api/v1/gbp/connections/${SUB}/picks`).set(auth(token)).send({ gbp_location_ids: ids });

	it('lists the connected accounts and one account\'s locations from Business Information only (C22: no Places calls)', async () => {
		const { token } = await owner('d@test.dev');
		expect((await request(app).get('/api/v1/gbp/connections').set(auth(token))).body.data).toEqual({ limit: 3, connections: [] });
		await connect(token);
		const accounts = await request(app).get('/api/v1/gbp/connections').set(auth(token));
		expect(accounts.body.data).toEqual({ limit: 3, connections: [{ google_sub: SUB, google_email: 'owner@example.test', status: 'active', picked: 0, bound: 0 }] });
		const res = await request(app).get(`/api/v1/gbp/connections/${SUB}/locations`).set(auth(token));
		expect(res.status).toBe(200);
		expect(res.body.data).toMatchObject({ google_sub: SUB, google_email: 'owner@example.test', errors: [] });
		expect(res.body.data.locations).toHaveLength(2); // the same 2 locations under both accounts, listed once
		expect(res.body.data.locations[0]).toMatchObject({
			gbpLocationId: 'locations/200000000000000000001',
			title: 'Example Plumbing Co',
			address: '100 Example St, Suite 5, Dallas, TX 75201',
			place_id: 'ChIJfakeGbpPlace000000001',
			supported: true,
			picked: false,
			pick_id: null,
			bound_location_id: null,
		});
		expect(placesCalls).not.toHaveBeenCalled();
		expect((await request(app).get('/api/v1/gbp/connections/unknown-sub/locations').set(auth(token))).body.data).toMatchObject({ reason: 'google_account_not_connected' });
	});

	it('pick only some locations: only those show on the locations page (pending_gbp), nothing is a location yet', async () => {
		const { token } = await owner('p@test.dev');
		await connect(token);
		let res = await pickAll(token, ['locations/200000000000000000001']);
		expect(res.status).toBe(200);
		expect(res.body.data).toMatchObject({ picked: 1, removed: 0, kept_bound: 0 });
		expect(res.body.data.locations.map((l: { picked: boolean }) => l.picked)).toEqual([true, false]);
		const list = await request(app).get('/api/v1/locations').set(auth(token));
		expect(list.body.data.locations).toEqual([]);
		expect(list.body.data.pending_gbp).toEqual([
			expect.objectContaining({ gbpLocationId: 'locations/200000000000000000001', title: 'Example Plumbing Co', google_email: 'owner@example.test', existing_location_id: null }),
		]);
		// Changing the selection replaces it; an unknown or malformed id is refused.
		res = await pickAll(token, ['locations/200000000000000000002']);
		expect(res.body.data).toMatchObject({ picked: 1, removed: 1 });
		expect((await pickAll(token, ['locations/999'])).body.data).toMatchObject({ reason: 'unknown_location', gbp_location_ids: ['locations/999'] });
		expect((await pickAll(token, ['bad'])).status).toBe(400);
		// Removing a pick from the locations page.
		const pickId = (await request(app).get('/api/v1/locations').set(auth(token))).body.data.pending_gbp[0].pick_id;
		expect((await request(app).delete(`/api/v1/gbp/picks/${pickId}`).set(auth(token))).body.data).toEqual({ removed: true, pick_id: pickId });
		expect((await request(app).get('/api/v1/locations').set(auth(token))).body.data.pending_gbp).toEqual([]);
	});

	it('Bind creates the location (subscription-gated: the trial allows 1, the next one answers 402); unbind keeps the location and the connection', async () => {
		const { token } = await owner('b@test.dev');
		await connect(token);
		const picks = (await pickAll(token, ['locations/200000000000000000001', 'locations/200000000000000000002'])).body.data.locations;
		const bound = await request(app).post(`/api/v1/gbp/picks/${picks[0].pick_id}/bind`).set(auth(token)).send({});
		expect(bound.status).toBe(200);
		expect(bound.body.data).toMatchObject({ pick_id: picks[0].pick_id, created: true, center_needed: false, binding: { binding: { gbpLocationId: 'locations/200000000000000000001' } } });
		const locationId = bound.body.data.location.location_id as string;
		expect((await request(app).post(`/api/v1/gbp/picks/${picks[0].pick_id}/bind`).set(auth(token)).send({})).body.data).toMatchObject({ reason: 'already_bound', location_id: locationId });
		// The trial covers one location: binding the second needs a subscription.
		const second = await request(app).post(`/api/v1/gbp/picks/${picks[1].pick_id}/bind`).set(auth(token)).send({});
		expect([second.status, second.body.data.reason]).toEqual([402, 'subscription_required']);
		let list = (await request(app).get('/api/v1/locations').set(auth(token))).body.data;
		expect(list.locations.map((l: { location_id: string }) => l.location_id)).toEqual([locationId]);
		expect(list.pending_gbp.map((p: { pick_id: string }) => p.pick_id)).toEqual([picks[1].pick_id]);
		expect((await request(app).get('/api/v1/gbp/connections').set(auth(token))).body.data.connections[0]).toMatchObject({ picked: 1, bound: 1 });
		// A bound pick can't be removed or unpicked; unbind instead.
		expect((await request(app).delete(`/api/v1/gbp/picks/${picks[0].pick_id}`).set(auth(token))).body.data).toMatchObject({ reason: 'already_bound' });
		expect((await pickAll(token, [])).body.data).toMatchObject({ removed: 1, kept_bound: 1 });

		const unbound = await request(app).post('/api/v1/gbp/unbind').set(auth(token)).send({ location_id: locationId });
		expect(unbound.body.data).toMatchObject({ unbound: true });
		expect(cancelMock).toHaveBeenCalled();
		list = (await request(app).get('/api/v1/locations').set(auth(token))).body.data;
		expect(list.locations).toEqual([expect.objectContaining({ location_id: locationId, gbp_connected: false })]);
		expect(await UserAuth.countDocuments({ token_type: tokenTypes.GBP })).toBe(1);
		expect((await request(app).post('/api/v1/gbp/unbind').set(auth(token)).send({ location_id: locationId })).status).toBe(404);
		// Picking the same profile again links to the existing location (no new location slot).
		const again = (await pickAll(token, ['locations/200000000000000000001'])).body.data.locations[0];
		expect((await request(app).get('/api/v1/locations').set(auth(token))).body.data.pending_gbp[0]).toMatchObject({ existing_location_id: locationId });
		const relinked = await request(app).post(`/api/v1/gbp/picks/${again.pick_id}/bind`).set(auth(token)).send({});
		expect(relinked.body.data).toMatchObject({ created: false, location: { location_id: locationId } });
	});

	it('disconnect revokes, unbinds that account\'s locations and removes its picks', async () => {
		const { user, token } = await owner('h@test.dev');
		await connect(token);
		const picks = (await pickAll(token, ['locations/200000000000000000001', 'locations/200000000000000000002'])).body.data.locations;
		const bound = await request(app).post(`/api/v1/gbp/picks/${picks[0].pick_id}/bind`).set(auth(token)).send({});
		const res = await request(app).post('/api/v1/gbp/disconnect').set(auth(token)).send({ google_sub: SUB });
		expect(res.status).toBe(200);
		expect(res.body.data).toEqual({ revoked: true, bindings_removed: 1, picks_removed: 2, google_email: 'owner@example.test' });
		expect(fake.revoked).toEqual(['1//FAKE-route']);
		expect(await UserAuth.countDocuments({ user_id: user._id })).toBe(0);
		const list = (await request(app).get('/api/v1/locations').set(auth(token))).body.data;
		expect(list.pending_gbp).toEqual([]);
		expect(list.locations).toEqual([expect.objectContaining({ location_id: bound.body.data.location.location_id, gbp_connected: false })]);
	});

	it('unbind validates input', async () => {
		const { token } = await owner('g@test.dev');
		expect((await request(app).post('/api/v1/gbp/unbind').set(auth(token)).send({ location_id: 'nope' })).status).toBe(400);
		expect((await request(app).post(`/api/v1/gbp/picks/${new Types.ObjectId().toHexString()}/bind`).set(auth(token)).send({})).status).toBe(404);
	});
});
