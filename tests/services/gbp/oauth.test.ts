import { Types } from 'mongoose';
import { GbpApiError } from '../../../src/clients/gbpClient';
import { OAuthTokens } from '../../../src/clients/types/gbp';
import { tokenTypes } from '../../../src/configs/constantTypes';
import { OAuthState, User, UserAuth, UserGBP } from '../../../src/models';
import { createIdTokenVerifier } from '../../../src/services/gbp/idToken';
import { GBP_SCOPE, STATE_TTL_MS, createGbpOAuthService, hashState } from '../../../src/services/gbp/oauth.service';
import { createTokenStore } from '../../../src/services/gbp/tokenStore';
import { createTokenCrypto } from '../../../src/utils/tokenCrypto';
import { TEST_CERTS, TEST_CLIENT_ID, signIdToken } from '../../helpers/idTokens';
import { clearDb, createLocation, createUser, startTestDb } from '../../helpers/mongoose';

jest.mock('../../../src/configs/mongoConnection', () => ({ agenda: {} }));

const NOW = new Date();
const OWNER_SUB = '100000000000000000001';
const OTHER_SUB = '100000000000000000002';
const tokens = createTokenStore(createTokenCrypto('e'.repeat(64)));

const googleTokens = (over: Partial<OAuthTokens> & { sub?: string; email?: string } = {}): OAuthTokens => {
	const { sub, email, ...rest } = over;
	return {
		accessToken: 'ya29.FAKE',
		refreshToken: '1//FAKE',
		expiryDate: new Date(NOW.getTime() + 3600_000),
		scope: `openid email ${GBP_SCOPE}`,
		idToken: signIdToken({ sub: sub ?? OWNER_SUB, email: email ?? 'owner@example.test' }),
		...rest,
	};
};

const setup = (opts: { exchange?: () => OAuthTokens; exchangeFails?: boolean } = {}) => {
	let clock = new Date(NOW);
	const exchanged: { code: string; redirectUri?: string }[] = [];
	const service = createGbpOAuthService({
		client: {
			exchangeCode: async (code: string, redirectUri?: string) => {
				exchanged.push({ code, redirectUri });
				if (opts.exchangeFails) throw new GbpApiError('GBP oauth.exchange failed: invalid_grant', { status: 400, reason: 'invalid_grant' }, 1);
				return opts.exchange ? opts.exchange() : googleTokens();
			},
		},
		tokens,
		verifyIdToken: createIdTokenVerifier({ clientId: TEST_CLIENT_ID, getCerts: async () => TEST_CERTS }),
		now: () => clock,
		clientId: TEST_CLIENT_ID,
		redirectUri: 'http://localhost:5055/api/v1/user/auth/google/gbp/callback',
	});
	return { service, exchanged, advance: (ms: number) => (clock = new Date(clock.getTime() + ms)) };
};

const stateOf = (url: string): string => new URL(url).searchParams.get('state') as string;

let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
	await Promise.all([OAuthState.syncIndexes(), UserAuth.syncIndexes()]);
});
afterAll(async () => db.stop());
beforeEach(async () => clearDb());

describe('redirect flow', () => {
	it('asks for openid, email and business.manage, offline, with the account chooser and consent', async () => {
		const { user } = await createUser('u@test.dev');
		const url = new URL(await setup().service.createAuthUrl(user._id));
		expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
		expect(Object.fromEntries(url.searchParams)).toMatchObject({
			client_id: TEST_CLIENT_ID,
			response_type: 'code',
			scope: 'openid email https://www.googleapis.com/auth/business.manage',
			access_type: 'offline',
			prompt: 'select_account consent',
		});
		expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});

	it('stores only a hash of the state, flow redirect, 10-minute expiry', async () => {
		const { user } = await createUser('u@test.dev');
		const state = stateOf(await setup().service.createAuthUrl(user._id));
		const rows = await OAuthState.find({}).lean();
		expect(rows[0]).toMatchObject({ token_hash: hashState(state), flow: 'redirect', used_at: null });
		expect(rows[0].expires_at.getTime()).toBe(NOW.getTime() + STATE_TTL_MS);
		expect(JSON.stringify(rows)).not.toContain(state);
	});

	it('connects: stores encrypted tokens + the verified Google email, marks the user connected', async () => {
		const { user } = await createUser('u@test.dev');
		const { service, exchanged } = setup();
		const state = stateOf(await service.createAuthUrl(user._id));
		expect(await service.handleCallback({ code: '4/code', state })).toEqual({ connected: true, google_email: 'owner@example.test', google_sub: OWNER_SUB });
		expect(exchanged).toEqual([{ code: '4/code', redirectUri: undefined }]);
		expect(await tokens.load(user._id, tokenTypes.GBP)).toMatchObject({
			accessToken: 'ya29.FAKE',
			refreshToken: '1//FAKE',
			googleEmail: 'owner@example.test',
			googleSub: OWNER_SUB,
		});
		expect((await User.findById(user._id))?.is_gbp_connected).toBe(true);
	});

	it('rejects replayed, expired, unknown and forged states', async () => {
		const { user } = await createUser('u@test.dev');
		const { service, advance, exchanged } = setup();
		const state = stateOf(await service.createAuthUrl(user._id));
		await service.handleCallback({ code: '4/a', state });
		await expect(service.handleCallback({ code: '4/b', state })).rejects.toMatchObject({ statusCode: 400 });
		const late = stateOf(await service.createAuthUrl(user._id));
		advance(STATE_TTL_MS + 1);
		await expect(service.handleCallback({ code: '4/c', state: late })).rejects.toMatchObject({ statusCode: 400 });
		const forged = JSON.stringify({ user_id: String(user._id) });
		await expect(service.handleCallback({ code: '4/d', state: forged })).rejects.toMatchObject({ statusCode: 400 });
		expect(exchanged.map((e) => e.code)).toEqual(['4/a']);
	});

	it('reports a declined consent, a rejected code and an invalid id_token as 400, saving nothing', async () => {
		const { user } = await createUser('u@test.dev');
		await expect(setup().service.handleCallback({ error: 'access_denied', state: 'x' })).rejects.toMatchObject({
			statusCode: 400,
			message: 'Google Business Profile access was not granted.',
		});
		const rejected = setup({ exchangeFails: true });
		await expect(
			rejected.service.handleCallback({ code: '4/x', state: stateOf(await rejected.service.createAuthUrl(user._id)) }),
		).rejects.toMatchObject({ statusCode: 400 });
		const badToken = setup({ exchange: () => googleTokens({ idToken: signIdToken({ aud: 'someone-else' }) }) });
		await expect(
			badToken.service.handleCallback({ code: '4/y', state: stateOf(await badToken.service.createAuthUrl(user._id)) }),
		).rejects.toMatchObject({ statusCode: 400, message: 'Could not verify the Google account. Start the connection again.' });
		const noToken = setup({ exchange: () => googleTokens({ idToken: null }) });
		await expect(
			noToken.service.handleCallback({ code: '4/z', state: stateOf(await noToken.service.createAuthUrl(user._id)) }),
		).rejects.toMatchObject({ statusCode: 400 });
		expect(await UserAuth.countDocuments({})).toBe(0);
	});
});

describe('popup flow', () => {
	it('returns the GIS code-client config with a popup state', async () => {
		const { user } = await createUser('u@test.dev');
		const popup = await setup().service.createPopupConfig(user._id);
		expect(popup).toMatchObject({
			client_id: TEST_CLIENT_ID,
			scope: 'openid email https://www.googleapis.com/auth/business.manage',
			ux_mode: 'popup',
			select_account: true,
		});
		expect(popup).not.toHaveProperty('prompt');
		expect(popup).not.toHaveProperty('access_type');
		expect(await OAuthState.findOne({ token_hash: hashState(popup.state) }).lean()).toMatchObject({ flow: 'popup' });
	});

	it('exchanges with redirect_uri "postmessage" and connects', async () => {
		const { user } = await createUser('u@test.dev');
		const { service, exchanged } = setup();
		const { state } = await service.createPopupConfig(user._id);
		expect(await service.handlePopupCode(user._id, { code: '4/popup', state })).toEqual({ connected: true, google_email: 'owner@example.test', google_sub: OWNER_SUB });
		expect(exchanged).toEqual([{ code: '4/popup', redirectUri: 'postmessage' }]);
	});

	it("rejects another user's state without consuming it", async () => {
		const { user: victim } = await createUser('victim@test.dev');
		const { user: attacker } = await createUser('attacker@test.dev');
		const { service, exchanged } = setup();
		const { state } = await service.createPopupConfig(victim._id);
		await expect(service.handlePopupCode(attacker._id, { code: '4/x', state })).rejects.toMatchObject({ statusCode: 400 });
		expect(exchanged).toEqual([]);
		await expect(service.handlePopupCode(victim._id, { code: '4/ok', state })).resolves.toMatchObject({ connected: true });
	});

	it('keeps popup and redirect states apart, and rejects replay', async () => {
		const { user } = await createUser('u@test.dev');
		const { service } = setup();
		const redirectState = stateOf(await service.createAuthUrl(user._id));
		await expect(service.handlePopupCode(user._id, { code: '4/a', state: redirectState })).rejects.toMatchObject({ statusCode: 400 });
		const { state: popupState } = await service.createPopupConfig(user._id);
		await expect(service.handleCallback({ code: '4/b', state: popupState })).rejects.toMatchObject({ statusCode: 400 });
		await service.handlePopupCode(user._id, { code: '4/c', state: popupState });
		await expect(service.handlePopupCode(user._id, { code: '4/d', state: popupState })).rejects.toMatchObject({ statusCode: 400 });
		await expect(service.handlePopupCode(user._id, { code: '', state: popupState })).rejects.toMatchObject({ statusCode: 400 });
	});
});

describe('several Google accounts and missing refresh tokens', () => {
	const connectAs = async (userId: Types.ObjectId, over: Parameters<typeof googleTokens>[0]) => {
		const { service } = setup({ exchange: () => googleTokens(over) });
		const { state } = await service.createPopupConfig(userId);
		return service.handlePopupCode(userId, { code: '4/code', state });
	};

	it('adds a second Google account as its own connection, even with bound locations (no 409)', async () => {
		const { user } = await createUser('u@test.dev');
		await connectAs(user._id as Types.ObjectId, {});
		const location = await createLocation(user._id as Types.ObjectId);
		await UserGBP.create({ user_id: user._id, location_id: location._id, gbpAccountId: 'accounts/1', gbpLocationId: 'locations/1', google_sub: OWNER_SUB });
		await expect(connectAs(user._id as Types.ObjectId, { sub: OTHER_SUB, email: 'other@example.test', refreshToken: '1//OTHER' })).resolves.toEqual({
			connected: true,
			google_email: 'other@example.test',
			google_sub: OTHER_SUB,
		});
		expect((await tokens.listConnections(user._id, tokenTypes.GBP)).map((c) => c.googleEmail)).toEqual(['owner@example.test', 'other@example.test']);
		expect(await tokens.load(user._id, tokenTypes.GBP, OWNER_SUB)).toMatchObject({ refreshToken: '1//FAKE' });
		expect(await tokens.load(user._id, tokenTypes.GBP, OTHER_SUB)).toMatchObject({ refreshToken: '1//OTHER' });
	});

	it('updates the same Google account instead of duplicating it', async () => {
		const { user } = await createUser('u@test.dev');
		await connectAs(user._id as Types.ObjectId, {});
		await connectAs(user._id as Types.ObjectId, { accessToken: 'ya29.SECOND', refreshToken: '1//SECOND' });
		expect(await UserAuth.countDocuments({ user_id: user._id })).toBe(1);
		expect(await tokens.load(user._id, tokenTypes.GBP, OWNER_SUB)).toMatchObject({ accessToken: 'ya29.SECOND', refreshToken: '1//SECOND' });
	});

	it('keeps the stored refresh token on a same-account reconnect without one', async () => {
		const { user } = await createUser('u@test.dev');
		await connectAs(user._id as Types.ObjectId, {});
		await connectAs(user._id as Types.ObjectId, { refreshToken: null, accessToken: 'ya29.NEW' });
		expect(await tokens.load(user._id, tokenTypes.GBP)).toMatchObject({ accessToken: 'ya29.NEW', refreshToken: '1//FAKE' });
	});

	it('asks to remove access and retry when a new account comes without a refresh token', async () => {
		const { user } = await createUser('u@test.dev');
		await expect(connectAs(user._id as Types.ObjectId, { refreshToken: null })).rejects.toMatchObject({
			statusCode: 400,
			message: expect.stringContaining('myaccount.google.com/permissions'),
		});
		await connectAs(user._id as Types.ObjectId, {});
		await expect(connectAs(user._id as Types.ObjectId, { sub: OTHER_SUB, refreshToken: null })).rejects.toMatchObject({ statusCode: 400 });
	});
});
