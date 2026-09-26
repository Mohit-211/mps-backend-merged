import { GbpApiError } from '../../../src/clients/gbpClient';
import { OAuthTokens } from '../../../src/clients/types/gbp';
import { tokenTypes } from '../../../src/configs/constantTypes';
import { OAuthState, User } from '../../../src/models';
import { GBP_SCOPE, STATE_TTL_MS, createGbpOAuthService, hashState } from '../../../src/services/gbp/oauth.service';
import { TokenUpdate } from '../../../src/services/gbp/tokenStore';
import { clearDb, createUser, startTestDb } from '../../helpers/mongoose';

const NOW = new Date('2026-09-26T10:00:00Z');
const TOKENS: OAuthTokens = {
	accessToken: 'ya29.FAKE',
	refreshToken: '1//FAKE',
	expiryDate: new Date(NOW.getTime() + 3600_000),
	scope: GBP_SCOPE,
};

const setup = (opts: { now?: Date; exchangeFails?: boolean } = {}) => {
	let clock = opts.now ?? NOW;
	const saved: { userId: string; type: string; update: TokenUpdate }[] = [];
	const exchanged: string[] = [];
	const service = createGbpOAuthService({
		client: {
			exchangeCode: async (code: string) => {
				exchanged.push(code);
				if (opts.exchangeFails) throw new GbpApiError('GBP oauth.exchange failed: invalid_grant', { status: 400, reason: 'invalid_grant' }, 1);
				return TOKENS;
			},
		},
		tokens: {
			save: async (userId, type, update) => {
				saved.push({ userId: String(userId), type, update });
			},
		},
		now: () => clock,
		clientId: 'client-id.apps.googleusercontent.com',
		redirectUri: 'http://localhost:5055/api/v1/user/auth/google/gbp/callback',
	});
	return { service, saved, exchanged, advance: (ms: number) => (clock = new Date(clock.getTime() + ms)) };
};

const stateOf = (url: string): string => new URL(url).searchParams.get('state') as string;

let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
	await OAuthState.syncIndexes();
});
afterAll(async () => db.stop());
beforeEach(async () => clearDb());

describe('GBP OAuth: auth URL', () => {
	it('asks for business.manage only, offline access and consent, with a random state', async () => {
		const { user } = await createUser('u@test.dev');
		const { service } = setup();
		const url = new URL(await service.createAuthUrl(user._id));
		expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
		expect(Object.fromEntries(url.searchParams)).toMatchObject({
			client_id: 'client-id.apps.googleusercontent.com',
			redirect_uri: 'http://localhost:5055/api/v1/user/auth/google/gbp/callback',
			response_type: 'code',
			scope: 'https://www.googleapis.com/auth/business.manage',
			access_type: 'offline',
			prompt: 'consent',
		});
		const state = url.searchParams.get('state') as string;
		expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 random bytes, base64url
		expect(state).not.toContain(String(user._id));
	});

	it('stores only a hash of the state, with a 10-minute expiry', async () => {
		const { user } = await createUser('u@test.dev');
		const { service } = setup();
		const state = stateOf(await service.createAuthUrl(user._id));
		const rows = await OAuthState.find({}).lean();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ token_hash: hashState(state), purpose: 'gbp', used_at: null });
		expect(String(rows[0].user_id)).toBe(String(user._id));
		expect(rows[0].expires_at.getTime()).toBe(NOW.getTime() + STATE_TTL_MS);
		expect(JSON.stringify(rows)).not.toContain(state);
	});
});

describe('GBP OAuth: callback', () => {
	it('resolves the user from the stored state, saves tokens and marks the user connected', async () => {
		const { user } = await createUser('u@test.dev');
		const { service, saved, exchanged } = setup();
		const state = stateOf(await service.createAuthUrl(user._id));
		expect(await service.handleCallback({ code: '4/code', state })).toEqual({ connected: true });
		expect(exchanged).toEqual(['4/code']);
		expect(saved).toEqual([
			{
				userId: String(user._id),
				type: tokenTypes.GBP,
				update: { accessToken: 'ya29.FAKE', refreshToken: '1//FAKE', expiryDate: TOKENS.expiryDate, scope: GBP_SCOPE },
			},
		]);
		expect((await User.findById(user._id))?.is_gbp_connected).toBe(true);
	});

	it('rejects a replayed state (one use only)', async () => {
		const { user } = await createUser('u@test.dev');
		const { service, exchanged } = setup();
		const state = stateOf(await service.createAuthUrl(user._id));
		await service.handleCallback({ code: '4/code', state });
		await expect(service.handleCallback({ code: '4/code-2', state })).rejects.toMatchObject({ statusCode: 400 });
		expect(exchanged).toEqual(['4/code']);
	});

	it('rejects an expired state', async () => {
		const { user } = await createUser('u@test.dev');
		const { service, advance, exchanged } = setup();
		const state = stateOf(await service.createAuthUrl(user._id));
		advance(STATE_TTL_MS + 1);
		await expect(service.handleCallback({ code: '4/code', state })).rejects.toMatchObject({ statusCode: 400 });
		expect(exchanged).toEqual([]);
	});

	it('rejects unknown states, including the old JSON state with an injected user_id', async () => {
		const { user } = await createUser('victim@test.dev');
		const { service, exchanged } = setup();
		await service.createAuthUrl(user._id);
		const forged = JSON.stringify({ user_id: String(user._id), user_type: 'BUSINESS' });
		for (const state of [forged, 'not-a-real-state', '']) {
			await expect(service.handleCallback({ code: '4/code', state })).rejects.toMatchObject({ statusCode: 400 });
		}
		expect(exchanged).toEqual([]);
		expect((await User.findById(user._id))?.is_gbp_connected).toBe(false);
	});

	it('reports a declined consent and a missing code clearly', async () => {
		const { service } = setup();
		await expect(service.handleCallback({ error: 'access_denied', state: 'x' })).rejects.toMatchObject({
			statusCode: 400,
			message: 'Google Business Profile access was not granted.',
		});
		await expect(service.handleCallback({ state: 'x' })).rejects.toMatchObject({ statusCode: 400 });
	});

	it('maps a rejected code exchange to 400 without saving anything', async () => {
		const { user } = await createUser('u@test.dev');
		const { service, saved } = setup({ exchangeFails: true });
		const state = stateOf(await service.createAuthUrl(user._id));
		await expect(service.handleCallback({ code: '4/bad', state })).rejects.toMatchObject({ statusCode: 400 });
		expect(saved).toEqual([]);
	});
});
