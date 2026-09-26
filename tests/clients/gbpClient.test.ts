import {
	DISCOVERY_READ_MASK,
	GbpAccessNotApprovedError,
	GbpApiDisabledError,
	GbpApiError,
	GbpNotConnectedError,
	GbpReauthRequiredError,
	createGbpClient,
	createRateLimiter,
} from '../../src/clients/gbpClient';
import { StoredTokens, TokenUpdate } from '../../src/services/gbp/tokenStore';
import { FakeStep, createFakeTransport } from '../helpers/fakeTransport';

const USER = 'user-1';
const T0 = Date.parse('2026-09-26T10:00:00Z');

/** In-memory token store + fake clock, so the client can be tested without Mongo or real time. */
const setup = (steps: FakeStep[], stored: Partial<StoredTokens> | null = {}) => {
	let t = T0;
	const clock = { now: () => t, sleep: async (ms: number) => void (t += ms) };
	const sleeps: number[] = [];
	const state = {
		tokens:
			stored === null
				? null
				: ({
						accessToken: 'ya29.FAKE-stored',
						refreshToken: '1//FAKE-stored-refresh',
						expiryDate: new Date(T0 + 30 * 60_000),
						scope: null,
						status: 'active',
						...stored,
					} as StoredTokens),
		refreshed: [] as TokenUpdate[],
		revoked: [] as string[],
	};
	const tokens = {
		load: async () => state.tokens,
		saveRefreshed: async (_u: unknown, _t: string, update: TokenUpdate) => {
			state.refreshed.push(update);
			if (state.tokens) {
				state.tokens = {
					...state.tokens,
					accessToken: update.accessToken,
					refreshToken: update.refreshToken ?? state.tokens.refreshToken,
					expiryDate: update.expiryDate,
				};
			}
		},
		markRevoked: async (_u: unknown, _t: string, message: string) => {
			state.revoked.push(message);
		},
	};
	const fake = createFakeTransport(steps);
	const client = createGbpClient({
		transport: fake.transport,
		tokens,
		clientId: 'client-id.apps.googleusercontent.com',
		clientSecret: 'FAKE-client-secret',
		redirectUri: 'http://localhost:5055/api/v1/user/auth/google/gbp/callback',
		maxRps: 5,
		now: clock.now,
		sleep: async (ms) => {
			sleeps.push(ms);
			await clock.sleep(ms);
		},
	});
	return { client, fake, state, sleeps, clock };
};

describe('gbpClient discovery', () => {
	it('lists every account across pages', async () => {
		const { client, fake } = setup([
			{ status: 200, fixture: 'gbp/accounts_p1' },
			{ status: 200, fixture: 'gbp/accounts_p2' },
		]);
		const accounts = await client.listAccounts(USER);
		expect(accounts.map((a) => a.name)).toEqual([
			'accounts/100000000000000000001',
			'accounts/100000000000000000002',
			'accounts/100000000000000000003',
		]);
		expect(accounts[1]).toMatchObject({ accountName: 'Example Agency Group', type: 'LOCATION_GROUP' });
		expect(fake.requests[0].url).toBe('https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=20');
		expect(fake.requests[1].url).toContain('pageToken=acct-page-2');
		expect(fake.requests[0].headers.Authorization).toBe('Bearer ya29.FAKE-stored');
	});

	it('lists every location of an account with the readMask, across pages', async () => {
		const { client, fake } = setup([
			{ status: 200, fixture: 'gbp/locations_p1' },
			{ status: 200, fixture: 'gbp/locations_p2' },
		]);
		const locations = await client.listLocations(USER, 'accounts/100000000000000000001');
		expect(locations).toHaveLength(3);
		expect(locations[0]).toMatchObject({
			name: 'locations/200000000000000000001',
			title: 'Example Plumbing Co',
			placeId: 'ChIJfakeGbpPlace000000001',
			primaryPhone: '(214) 555-0100',
			primaryCategory: 'Plumber',
			latlng: { latitude: 32.7801, longitude: -96.8005 },
		});
		expect(locations[2]).toMatchObject({ storefrontAddress: null, placeId: null, latlng: null, websiteUri: null });
		const url = new URL(fake.requests[0].url);
		expect(url.pathname).toBe('/v1/accounts/100000000000000000001/locations');
		expect(url.searchParams.get('readMask')).toBe(DISCOVERY_READ_MASK);
		expect(url.searchParams.get('pageSize')).toBe('100');
		expect(new URL(fake.requests[1].url).searchParams.get('pageToken')).toBe('loc-page-2');
	});

	it('gets one location', async () => {
		const { client, fake } = setup([{ status: 200, fixture: 'gbp/location' }]);
		const location = await client.getLocation(USER, 'locations/200000000000000000001');
		expect(location.placeId).toBe('ChIJfakeGbpPlace000000001');
		expect(fake.requests[0].url).toContain('/v1/locations/200000000000000000001?readMask=');
	});
});

describe('gbpClient tokens', () => {
	it('refreshes a nearly expired token before the call and persists it', async () => {
		const { client, fake, state } = setup(
			[
				{ status: 200, fixture: 'gbp/token_refreshed' },
				{ status: 200, fixture: 'gbp/accounts_p2' },
			],
			{ expiryDate: new Date(T0 + 30_000) }, // 30 s left < 60 s margin
		);
		await client.listAccounts(USER);
		expect(fake.requests[0]).toMatchObject({ method: 'POST', url: 'https://oauth2.googleapis.com/token' });
		const form = new URLSearchParams(fake.requests[0].data as string);
		expect(form.get('grant_type')).toBe('refresh_token');
		expect(form.get('refresh_token')).toBe('1//FAKE-stored-refresh');
		expect(fake.requests[1].headers.Authorization).toBe('Bearer ya29.FAKE-access-refreshed');
		expect(state.refreshed).toEqual([
			{ accessToken: 'ya29.FAKE-access-refreshed', refreshToken: null, expiryDate: new Date(T0 + 3599_000) },
		]);
	});

	it('stores a rotated refresh token', async () => {
		const { client, state } = setup(
			[
				{ status: 200, fixture: 'gbp/token_rotated' },
				{ status: 200, fixture: 'gbp/accounts_p2' },
			],
			{ expiryDate: null },
		);
		await client.listAccounts(USER);
		expect(state.refreshed[0].refreshToken).toBe('1//FAKE-refresh-rotated');
		expect(state.tokens?.refreshToken).toBe('1//FAKE-refresh-rotated');
	});

	it('refreshes once on a 401 and retries the call', async () => {
		const { client, fake } = setup([
			{ status: 401, fixture: 'gbp/error_unauthenticated' },
			{ status: 200, fixture: 'gbp/token_refreshed' },
			{ status: 200, fixture: 'gbp/accounts_p2' },
		]);
		const accounts = await client.listAccounts(USER);
		expect(accounts).toHaveLength(1);
		expect(fake.requests.map((r) => r.url.split('?')[0])).toEqual([
			'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
			'https://oauth2.googleapis.com/token',
			'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
		]);
		expect(fake.requests[2].headers.Authorization).toBe('Bearer ya29.FAKE-access-refreshed');
	});

	it('marks the connection revoked on invalid_grant and asks the user to reconnect', async () => {
		const { client, state } = setup([{ status: 400, fixture: 'gbp/error_invalid_grant' }], { expiryDate: null });
		await expect(client.listAccounts(USER)).rejects.toBeInstanceOf(GbpReauthRequiredError);
		expect(state.revoked).toHaveLength(1);
		expect(state.revoked[0]).toContain('invalid_grant');
	});

	it('refuses without a connection, or with a revoked one, before any call', async () => {
		const none = setup([], null);
		await expect(none.client.listAccounts(USER)).rejects.toBeInstanceOf(GbpNotConnectedError);
		const revoked = setup([], { status: 'revoked' });
		await expect(revoked.client.listAccounts(USER)).rejects.toBeInstanceOf(GbpReauthRequiredError);
		expect(none.fake.requests.length + revoked.fake.requests.length).toBe(0);
	});

	it('exchanges an authorisation code', async () => {
		const { client, fake } = setup([{ status: 200, fixture: 'gbp/token' }]);
		const tokens = await client.exchangeCode('4/FAKE-code');
		expect(tokens).toEqual({
			accessToken: 'ya29.FAKE-access-initial',
			refreshToken: '1//FAKE-refresh-initial',
			expiryDate: new Date(T0 + 3599_000),
			scope: 'https://www.googleapis.com/auth/business.manage',
		});
		const form = new URLSearchParams(fake.requests[0].data as string);
		expect(Object.fromEntries(form)).toMatchObject({
			code: '4/FAKE-code',
			grant_type: 'authorization_code',
			redirect_uri: 'http://localhost:5055/api/v1/user/auth/google/gbp/callback',
		});
	});

	it('revokes with the token in the body, not the URL', async () => {
		const { client, fake } = setup([{ status: 200, body: {} }]);
		await client.revoke('1//FAKE-stored-refresh');
		expect(fake.requests[0].url).toBe('https://oauth2.googleapis.com/revoke');
		expect(fake.requests[0].data).toBe('token=1%2F%2FFAKE-stored-refresh');
	});
});

describe('gbpClient errors and retries', () => {
	it('backs off on 429 and then succeeds', async () => {
		const { client, sleeps } = setup([
			{ status: 429, fixture: 'gbp/error_rate_limited' },
			{ status: 429, fixture: 'gbp/error_rate_limited' },
			{ status: 200, fixture: 'gbp/accounts_p2' },
		]);
		expect(await client.listAccounts(USER)).toHaveLength(1);
		expect(sleeps.filter((ms) => ms >= 1000)).toEqual([1000, 2000]);
	});

	it('gives up after 3 retries on 429', async () => {
		const { client, fake } = setup(Array(4).fill({ status: 429, fixture: 'gbp/error_rate_limited' }));
		await expect(client.listAccounts(USER)).rejects.toMatchObject({ status: 429, apiCalls: 4 });
		expect(fake.remaining()).toBe(0);
	});

	it('fails fast with "access not approved" on a quota-0 429 (no retry)', async () => {
		const { client, fake } = setup([{ status: 429, fixture: 'gbp/error_quota0' }]);
		const err = await client.listAccounts(USER).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(GbpAccessNotApprovedError);
		expect((err as Error).message).toMatch(/^GBP API access not approved \(quota 0\)/);
		expect(fake.requests).toHaveLength(1);
	});

	it('reports a disabled API by name', async () => {
		const { client } = setup([{ status: 403, fixture: 'gbp/error_service_disabled' }]);
		const err = await client.listAccounts(USER).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(GbpApiDisabledError);
		expect((err as Error).message).toContain('My Business Account Management API');
	});

	it('retries a 5xx once, then fails with a safe error', async () => {
		const { client } = setup([
			{ status: 503, body: { error: { code: 503, message: 'Backend unavailable', status: 'UNAVAILABLE' } } },
			{ status: 503, body: { error: { code: 503, message: 'Backend unavailable', status: 'UNAVAILABLE' } } },
		]);
		const err = await client.listAccounts(USER).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(GbpApiError);
		expect(err).toMatchObject({ status: 503, apiCalls: 2 });
	});

	it('never puts tokens or the client secret in error messages', async () => {
		const { client } = setup([{ status: 400, fixture: 'gbp/error_invalid_grant' }], { expiryDate: null });
		const err = (await client.listAccounts(USER).catch((e: unknown) => e)) as Error;
		const text = `${err.message} ${JSON.stringify(err)}`;
		for (const secret of ['ya29.FAKE-stored', '1//FAKE-stored-refresh', 'FAKE-client-secret']) expect(text).not.toContain(secret);
	});
});

describe('rate limiter', () => {
	it('never starts more than 5 calls in any 1-second window', async () => {
		let t = 0;
		const limiter = createRateLimiter(5, () => t, async (ms) => void (t += ms));
		const starts: number[] = [];
		await Promise.all(Array.from({ length: 12 }, () => limiter.acquire().then(() => starts.push(t))));
		for (const s of starts) expect(starts.filter((x) => x >= s && x < s + 1000).length).toBeLessThanOrEqual(5);
		expect(starts.slice(0, 5)).toEqual([0, 0, 0, 0, 0]);
		expect(starts[5]).toBe(1000);
		expect(starts[10]).toBe(2000);
	});

	it('throttles real client calls too', async () => {
		const steps: FakeStep[] = Array(6).fill({ status: 200, fixture: 'gbp/location' });
		const { client, clock } = setup(steps);
		await Promise.all(Array.from({ length: 6 }, () => client.getLocation(USER, 'locations/1')));
		expect(clock.now() - T0).toBeGreaterThanOrEqual(1000);
	});
});
