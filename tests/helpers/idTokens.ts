import crypto from 'crypto';

// Signs Google-style id_tokens with a local RSA key so id_token verification can be tested offline.

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
export const TEST_KID = 'test-kid-1';
export const TEST_CERTS: Record<string, string> = {
	[TEST_KID]: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
};
export const TEST_CLIENT_ID = 'client-id.apps.googleusercontent.com';

const b64 = (value: object | Buffer): string =>
	(Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value))).toString('base64url');

export interface IdTokenClaims {
	sub?: string;
	email?: string;
	email_verified?: boolean;
	aud?: string;
	iss?: string;
	iat?: number;
	exp?: number;
}

export const signIdToken = (claims: IdTokenClaims = {}, key: crypto.KeyObject = privateKey): string => {
	const now = Math.floor(Date.now() / 1000);
	const payload = {
		iss: 'https://accounts.google.com',
		aud: TEST_CLIENT_ID,
		sub: '100000000000000000001',
		email: 'owner@example.test',
		email_verified: true,
		iat: now,
		exp: now + 3600,
		...claims,
	};
	const unsigned = `${b64({ alg: 'RS256', typ: 'JWT', kid: TEST_KID })}.${b64(payload)}`;
	const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), key);
	return `${unsigned}.${b64(signature)}`;
};

export const otherPrivateKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
