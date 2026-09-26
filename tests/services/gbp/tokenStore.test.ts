import { tokenTypes } from '../../../src/configs/constantTypes';
import { User, UserAuth } from '../../../src/models';
import { createTokenStore, encryptPlaintextGbpTokens } from '../../../src/services/gbp/tokenStore';
import { createTokenCrypto, isEncrypted } from '../../../src/utils/tokenCrypto';
import { clearDb, createUser, startTestDb } from '../../helpers/mongoose';

const crypto = createTokenCrypto('c'.repeat(64));
const store = createTokenStore(crypto);
const expiry = new Date('2026-09-26T12:00:00Z');

let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
	await UserAuth.syncIndexes();
});
afterAll(async () => db.stop());
beforeEach(async () => clearDb());

const rawRow = (userId: unknown, type: string) => UserAuth.findOne({ user_id: userId, token_type: type }).lean();

describe('tokenStore', () => {
	it('encrypts GBP tokens at rest and saves expiry_date (C17)', async () => {
		const { user } = await createUser('a@test.dev');
		await store.save(user._id, tokenTypes.GBP, { accessToken: 'ya29.access', refreshToken: '1//refresh', expiryDate: expiry, scope: 's' });
		const row = await rawRow(user._id, tokenTypes.GBP);
		expect(isEncrypted(row?.access_token)).toBe(true);
		expect(isEncrypted(row?.refresh_token)).toBe(true);
		expect(JSON.stringify(row)).not.toContain('ya29.access');
		expect(row?.expiry_date?.toISOString()).toBe(expiry.toISOString());
		expect(await store.load(user._id, tokenTypes.GBP)).toEqual({
			accessToken: 'ya29.access',
			refreshToken: '1//refresh',
			expiryDate: expiry,
			scope: 's',
			status: 'active',
		});
	});

	it('never overwrites the Search Console row when GBP connects (C17 regression)', async () => {
		const { user } = await createUser('b@test.dev');
		await store.save(user._id, tokenTypes.ANALYTICS, { accessToken: 'sc-access', refreshToken: 'sc-refresh', expiryDate: expiry });
		await store.save(user._id, tokenTypes.GBP, { accessToken: 'gbp-access', refreshToken: 'gbp-refresh', expiryDate: expiry });
		await store.save(user._id, tokenTypes.GBP, { accessToken: 'gbp-access-2', refreshToken: 'gbp-refresh-2', expiryDate: expiry });
		expect(await UserAuth.countDocuments({ user_id: user._id })).toBe(2);
		const sc = await rawRow(user._id, tokenTypes.ANALYTICS);
		expect(sc).toMatchObject({ access_token: 'sc-access', refresh_token: 'sc-refresh' }); // untouched, plaintext
		expect((await store.load(user._id, tokenTypes.GBP))?.accessToken).toBe('gbp-access-2');
	});

	it('keeps the stored refresh token when Google omits one, and rejects a first connect without one', async () => {
		const { user } = await createUser('c@test.dev');
		await expect(store.save(user._id, tokenTypes.GBP, { accessToken: 'a', expiryDate: expiry })).rejects.toThrow(/refresh token/);
		await store.save(user._id, tokenTypes.GBP, { accessToken: 'a', refreshToken: 'r1', expiryDate: expiry });
		await store.save(user._id, tokenTypes.GBP, { accessToken: 'a2', refreshToken: null, expiryDate: expiry });
		expect(await store.load(user._id, tokenTypes.GBP)).toMatchObject({ accessToken: 'a2', refreshToken: 'r1' });
	});

	it('persists refreshed and rotated tokens', async () => {
		const { user } = await createUser('d@test.dev');
		await store.save(user._id, tokenTypes.GBP, { accessToken: 'a', refreshToken: 'r1', expiryDate: expiry });
		const later = new Date('2026-09-26T13:00:00Z');
		await store.saveRefreshed(user._id, tokenTypes.GBP, { accessToken: 'a2', expiryDate: later });
		expect(await store.load(user._id, tokenTypes.GBP)).toMatchObject({ accessToken: 'a2', refreshToken: 'r1', expiryDate: later });
		await store.saveRefreshed(user._id, tokenTypes.GBP, { accessToken: 'a3', refreshToken: 'r2', expiryDate: later });
		expect(await store.load(user._id, tokenTypes.GBP)).toMatchObject({ accessToken: 'a3', refreshToken: 'r2' });
		expect((await rawRow(user._id, tokenTypes.GBP))?.last_refreshed_at).toBeInstanceOf(Date);
	});

	it('re-encrypts a legacy plaintext GBP row on first read', async () => {
		const { user } = await createUser('e@test.dev');
		await UserAuth.create({ user_id: user._id, token_type: tokenTypes.GBP, access_token: 'old-a', refresh_token: 'old-r', expiry_date: expiry });
		expect(await store.load(user._id, tokenTypes.GBP)).toMatchObject({ accessToken: 'old-a', refreshToken: 'old-r' });
		const row = await rawRow(user._id, tokenTypes.GBP);
		expect(isEncrypted(row?.access_token) && isEncrypted(row?.refresh_token)).toBe(true);
		expect(await store.load(user._id, tokenTypes.GBP)).toMatchObject({ accessToken: 'old-a', refreshToken: 'old-r' });
	});

	it('marks a revoked connection and clears the user flag', async () => {
		const { user } = await createUser('f@test.dev');
		await User.updateOne({ _id: user._id }, { is_gbp_connected: true });
		await store.save(user._id, tokenTypes.GBP, { accessToken: 'a', refreshToken: 'r', expiryDate: expiry });
		await store.markRevoked(user._id, tokenTypes.GBP, 'invalid_grant: Token has been expired or revoked.');
		expect((await store.load(user._id, tokenTypes.GBP))?.status).toBe('revoked');
		expect((await User.findById(user._id))?.is_gbp_connected).toBe(false);
	});

	it('allows only one active row per user and type', async () => {
		const { user } = await createUser('g@test.dev');
		await UserAuth.create({ user_id: user._id, token_type: tokenTypes.GBP, access_token: 'x', refresh_token: 'y' });
		await expect(
			UserAuth.create({ user_id: user._id, token_type: tokenTypes.GBP, access_token: 'x2', refresh_token: 'y2' }),
		).rejects.toThrow(/duplicate key/);
	});

	it('removes a token type', async () => {
		const { user } = await createUser('h@test.dev');
		await store.save(user._id, tokenTypes.GBP, { accessToken: 'a', refreshToken: 'r', expiryDate: expiry });
		expect(await store.remove(user._id, tokenTypes.GBP)).toBe(true);
		expect(await store.load(user._id, tokenTypes.GBP)).toBeNull();
		expect(await store.remove(user._id, tokenTypes.GBP)).toBe(false);
	});
});

describe('encryptPlaintextGbpTokens (migration)', () => {
	it('encrypts plaintext GBP rows only, and a second run changes nothing', async () => {
		const { user: u1 } = await createUser('m1@test.dev');
		const { user: u2 } = await createUser('m2@test.dev');
		await UserAuth.create({ user_id: u1._id, token_type: tokenTypes.GBP, access_token: 'p-a', refresh_token: 'p-r' });
		await store.save(u2._id, tokenTypes.GBP, { accessToken: 'e-a', refreshToken: 'e-r', expiryDate: expiry });
		await UserAuth.create({ user_id: u1._id, token_type: tokenTypes.ANALYTICS, access_token: 'sc-a', refresh_token: 'sc-r' });

		expect(await encryptPlaintextGbpTokens(crypto)).toEqual({ scanned: 2, encrypted: 1, alreadyEncrypted: 1 });
		const before = await UserAuth.find({}).lean();
		expect(await encryptPlaintextGbpTokens(crypto)).toEqual({ scanned: 2, encrypted: 0, alreadyEncrypted: 2 });
		expect(await UserAuth.find({}).lean()).toEqual(before);
		expect(await store.load(u1._id, tokenTypes.GBP)).toMatchObject({ accessToken: 'p-a', refreshToken: 'p-r' });
		expect((await rawRow(u1._id, tokenTypes.ANALYTICS))?.access_token).toBe('sc-a');
	});
});
