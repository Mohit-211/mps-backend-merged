import { IdTokenError, createIdTokenVerifier } from '../../../src/services/gbp/idToken';
import { TEST_CERTS, TEST_CLIENT_ID, otherPrivateKey, signIdToken } from '../../helpers/idTokens';

const verify = createIdTokenVerifier({ clientId: TEST_CLIENT_ID, getCerts: async () => TEST_CERTS });
const now = Math.floor(Date.now() / 1000);

describe('Google id_token verification', () => {
	it('accepts a valid token and returns the identity (email lower-cased)', async () => {
		await expect(verify(signIdToken({ email: 'Owner@Example.test' }))).resolves.toEqual({
			sub: '100000000000000000001',
			email: 'owner@example.test',
		});
	});

	it('accepts the short issuer form', async () => {
		await expect(verify(signIdToken({ iss: 'accounts.google.com' }))).resolves.toMatchObject({ sub: '100000000000000000001' });
	});

	it.each([
		['wrong audience', { aud: 'someone-else.apps.googleusercontent.com' }, /wrong audience/],
		['expired', { iat: now - 7200, exp: now - 3600 }, /expired/],
		['wrong issuer', { iss: 'https://evil.example' }, /wrong issuer/],
	])('rejects %s', async (_label, claims, message) => {
		await expect(verify(signIdToken(claims))).rejects.toThrow(message);
	});

	it('rejects a token signed with another key, and garbage', async () => {
		await expect(verify(signIdToken({}, otherPrivateKey))).rejects.toBeInstanceOf(IdTokenError);
		await expect(verify('not.a.jwt')).rejects.toBeInstanceOf(IdTokenError);
		await expect(verify(null)).rejects.toThrow(/openid scope/);
	});

	it('requires a verified email', async () => {
		await expect(verify(signIdToken({ email_verified: false }))).rejects.toThrow(/not verified/);
	});

	it('never echoes the token in the error', async () => {
		const token = signIdToken({ aud: 'x' });
		const err = (await verify(token).catch((e: unknown) => e)) as Error;
		expect(err.message).not.toContain(token.slice(0, 20));
	});
});
