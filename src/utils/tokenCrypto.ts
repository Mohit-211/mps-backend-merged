import crypto from 'crypto';
import config from '../configs/config';

// AES-256-GCM encryption for stored OAuth tokens (CLAUDE.md §10). Each value gets a random 12-byte IV;
// the auth tag makes tampering (or a wrong key) fail loudly instead of returning garbage.
// Stored format: enc:v1:<iv b64>:<tag b64>:<ciphertext b64>. The prefix makes migrations idempotent.

const PREFIX = 'enc:v1:';
const KEY_PATTERN = /^[0-9a-fA-F]{64}$/;

export class TokenCryptoConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'TokenCryptoConfigError';
	}
}

export class TokenDecryptError extends Error {
	constructor() {
		super('Stored token could not be decrypted (wrong TOKEN_ENCRYPTION_KEY or tampered value)');
		this.name = 'TokenDecryptError';
	}
}

const keyFrom = (hex: string | undefined): Buffer => {
	if (!hex) throw new TokenCryptoConfigError('TOKEN_ENCRYPTION_KEY not set');
	if (!KEY_PATTERN.test(hex)) throw new TokenCryptoConfigError('TOKEN_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
	return Buffer.from(hex, 'hex');
};

export const isEncrypted = (value: string | null | undefined): boolean => typeof value === 'string' && value.startsWith(PREFIX);

export const createTokenCrypto = (keyHex: string | undefined) => {
	const encrypt = (plain: string): string => {
		const key = keyFrom(keyHex);
		const iv = crypto.randomBytes(12);
		const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
		const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
		const tag = cipher.getAuthTag();
		return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
	};

	const decrypt = (stored: string): string => {
		const key = keyFrom(keyHex);
		if (!isEncrypted(stored)) throw new TokenDecryptError();
		const [ivB64, tagB64, dataB64] = stored.slice(PREFIX.length).split(':');
		if (!ivB64 || !tagB64 || dataB64 === undefined) throw new TokenDecryptError();
		try {
			const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
			decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
			return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
		} catch {
			throw new TokenDecryptError();
		}
	};

	return { encrypt, decrypt, isEncrypted };
};

export type TokenCrypto = ReturnType<typeof createTokenCrypto>;

/** Default instance using TOKEN_ENCRYPTION_KEY (throws TokenCryptoConfigError on use when unset). */
export const tokenCrypto: TokenCrypto = createTokenCrypto(config.security.tokenEncryptionKey);
