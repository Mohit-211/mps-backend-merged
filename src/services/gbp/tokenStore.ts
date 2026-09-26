import { Types } from 'mongoose';
import httpStatus from 'http-status';
import logger from '../../configs/logger';
import { tokenTypes } from '../../configs/constantTypes';
import { IUserAuth, User, UserAuth } from '../../models';
import { ApiError } from '../../utils';
import { TokenCrypto, isEncrypted, tokenCrypto } from '../../utils/tokenCrypto';

// OAuth token storage (CLAUDE.md §10, AUDIT C17 + S12).
// - One active row per (user_id, token_type): every query filters on token_type, so a GBP connect
//   never overwrites the Search Console row again (unique partial index on the model).
// - expiry_date is saved (the old code wrote a non-existent `expires` field).
// - GBP tokens are encrypted at rest (AES-256-GCM). Search Console tokens stay plaintext until
//   Phase 10: their only readers are legacy ranking code deleted in Phase 9.
// - A legacy plaintext GBP value is accepted once and re-encrypted on read.

export type TokenType = string;

export interface StoredTokens {
	accessToken: string;
	refreshToken: string;
	expiryDate: Date | null;
	scope: string | null;
	status: 'active' | 'revoked';
	googleEmail: string | null;
	googleSub: string | null;
}

export interface TokenUpdate {
	accessToken: string;
	/** Omitted when Google did not issue a new one; the stored refresh token is kept. */
	refreshToken?: string | null;
	expiryDate: Date | null;
	scope?: string | null;
	/** Connected Google identity from the verified id_token (connect only). */
	googleEmail?: string | null;
	googleSub?: string | null;
}

type UserId = Types.ObjectId | string;

const encryptsType = (type: TokenType): boolean => type === tokenTypes.GBP;

export const createTokenStore = (crypto: TokenCrypto = tokenCrypto) => {
	const seal = (type: TokenType, value: string): string => (encryptsType(type) ? crypto.encrypt(value) : value);
	const open = (type: TokenType, value: string): string =>
		encryptsType(type) && isEncrypted(value) ? crypto.decrypt(value) : value;

	const activeRow = (userId: UserId, type: TokenType) =>
		UserAuth.findOne({ user_id: userId, token_type: type, is_active: true });

	/** Decrypted tokens, or null when the user has not connected. */
	const load = async (userId: UserId, type: TokenType): Promise<StoredTokens | null> => {
		const row = await activeRow(userId, type);
		if (!row) return null;
		if (encryptsType(type) && (!isEncrypted(row.access_token) || !isEncrypted(row.refresh_token))) {
			// Connected before Phase 6: encrypt in place now (idempotent per field).
			await UserAuth.updateOne(
				{ _id: row._id },
				{
					$set: {
						access_token: isEncrypted(row.access_token) ? row.access_token : crypto.encrypt(row.access_token),
						refresh_token: isEncrypted(row.refresh_token) ? row.refresh_token : crypto.encrypt(row.refresh_token),
						updated_at: new Date(),
					},
				},
			);
			logger.info(`tokenStore: re-encrypted legacy plaintext ${type} tokens for user ${String(userId)}`);
		}
		return {
			accessToken: open(type, row.access_token),
			refreshToken: open(type, row.refresh_token),
			expiryDate: row.expiry_date ?? null,
			scope: row.scope ?? null,
			status: row.status ?? 'active',
			googleEmail: row.google_email ?? null,
			googleSub: row.google_sub ?? null,
		};
	};

	/** Creates or replaces the user's active row for this token type (C17: filtered by token_type). */
	const save = async (userId: UserId, type: TokenType, update: TokenUpdate): Promise<void> => {
		const existing = await activeRow(userId, type);
		if (!existing && !update.refreshToken) {
			throw new ApiError(
				httpStatus.BAD_REQUEST,
				'Google did not return a refresh token. Remove MyPageSEO at myaccount.google.com/permissions and connect again.',
			);
		}
		const set: Partial<IUserAuth> = {
			access_token: seal(type, update.accessToken),
			expiry_date: update.expiryDate as Date,
			status: 'active',
			last_error: null,
			updated_at: new Date(),
		};
		if (update.refreshToken) set.refresh_token = seal(type, update.refreshToken);
		if (update.scope !== undefined) set.scope = update.scope;
		if (update.googleEmail !== undefined) set.google_email = update.googleEmail;
		if (update.googleSub !== undefined) set.google_sub = update.googleSub;
		if (existing) {
			await UserAuth.updateOne({ _id: existing._id }, { $set: set });
		} else {
			await UserAuth.create({ user_id: userId, token_type: type, is_active: true, ...set });
		}
	};

	/** After a successful refresh: new access token + expiry, and a rotated refresh token if Google sent one. */
	const saveRefreshed = async (userId: UserId, type: TokenType, update: TokenUpdate): Promise<void> => {
		const set: Partial<IUserAuth> = {
			access_token: seal(type, update.accessToken),
			expiry_date: update.expiryDate as Date,
			last_refreshed_at: new Date(),
			last_error: null,
			updated_at: new Date(),
		};
		if (update.refreshToken) set.refresh_token = seal(type, update.refreshToken);
		await UserAuth.updateOne({ user_id: userId, token_type: type, is_active: true }, { $set: set });
	};

	/** Google rejected the refresh token (invalid_grant): the user must reconnect. */
	const markRevoked = async (userId: UserId, type: TokenType, message: string): Promise<void> => {
		await UserAuth.updateOne(
			{ user_id: userId, token_type: type, is_active: true },
			{ $set: { status: 'revoked', last_error: message.slice(0, 300), updated_at: new Date() } },
		);
		if (type === tokenTypes.GBP) await User.updateOne({ _id: userId }, { $set: { is_gbp_connected: false } });
	};

	/** Deletes the user's row for this token type. Returns true if a row was removed. */
	const remove = async (userId: UserId, type: TokenType): Promise<boolean> => {
		const result = await UserAuth.deleteMany({ user_id: userId, token_type: type });
		return result.deletedCount > 0;
	};

	return { load, save, saveRefreshed, markRevoked, remove };
};

export type TokenStore = ReturnType<typeof createTokenStore>;

export const tokenStore: TokenStore = createTokenStore();

/**
 * Encrypts every plaintext GBP token in place (idempotent: already-encrypted values are skipped).
 * Used by `npm run gbp:encrypt-tokens`; never run automatically.
 */
export const encryptPlaintextGbpTokens = async (
	crypto: TokenCrypto = tokenCrypto,
): Promise<{ scanned: number; encrypted: number; alreadyEncrypted: number }> => {
	const rows = await UserAuth.find({ token_type: tokenTypes.GBP });
	let encrypted = 0;
	for (const row of rows) {
		const set: Record<string, string> = {};
		if (!isEncrypted(row.access_token)) set.access_token = crypto.encrypt(row.access_token);
		if (!isEncrypted(row.refresh_token)) set.refresh_token = crypto.encrypt(row.refresh_token);
		if (Object.keys(set).length === 0) continue;
		await UserAuth.updateOne({ _id: row._id }, { $set: set });
		encrypted += 1;
	}
	return { scanned: rows.length, encrypted, alreadyEncrypted: rows.length - encrypted };
};
