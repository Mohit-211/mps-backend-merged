import { TokenCryptoConfigError, TokenDecryptError, createTokenCrypto, isEncrypted } from '../../src/utils/tokenCrypto';

const KEY = 'a'.repeat(64);
const OTHER_KEY = 'b'.repeat(64);

describe('tokenCrypto', () => {
	const crypto = createTokenCrypto(KEY);

	it('round-trips and marks values as encrypted', () => {
		const stored = crypto.encrypt('ya29.fake-access-token');
		expect(isEncrypted(stored)).toBe(true);
		expect(stored).not.toContain('ya29');
		expect(crypto.decrypt(stored)).toBe('ya29.fake-access-token');
	});

	it('uses a fresh IV every time', () => {
		expect(crypto.encrypt('same')).not.toBe(crypto.encrypt('same'));
	});

	it('rejects a tampered value and a wrong key', () => {
		const stored = crypto.encrypt('secret');
		const parts = stored.split(':');
		const data = Buffer.from(parts[4], 'base64');
		data[0] ^= 1;
		parts[4] = data.toString('base64');
		expect(() => crypto.decrypt(parts.join(':'))).toThrow(TokenDecryptError);
		expect(() => createTokenCrypto(OTHER_KEY).decrypt(stored)).toThrow(TokenDecryptError);
		expect(() => crypto.decrypt('plaintext-token')).toThrow(TokenDecryptError);
	});

	it('requires a 64-hex-char key, but only when used', () => {
		expect(() => createTokenCrypto('').encrypt('x')).toThrow('TOKEN_ENCRYPTION_KEY not set');
		expect(() => createTokenCrypto('abc').encrypt('x')).toThrow(TokenCryptoConfigError);
		expect(() => createTokenCrypto('z'.repeat(64)).decrypt('enc:v1:a:b:c')).toThrow(TokenCryptoConfigError);
	});

	it('detects the prefix', () => {
		expect(isEncrypted('enc:v1:x')).toBe(true);
		expect(isEncrypted('ya29.plain')).toBe(false);
		expect(isEncrypted(null)).toBe(false);
	});
});
