import { Types } from 'mongoose';
import httpStatus from 'http-status';
import { tokenTypes } from '../../configs/constantTypes';
import { IUserAuth, User, UserAuth } from '../../models';
import { ApiError } from '../../utils';
import { TokenCrypto, tokenCrypto } from '../../utils/tokenCrypto';

// OAuth token storage (CLAUDE.md §10, AUDIT C17 + S12; multiple Google accounts in Phase 7a).
// - One active row per (user_id, token_type, google_sub): a user may connect several Google accounts
//   (a "connection" each, keyed by the id_token sub). Every query filters on token_type, so GBP never
//   overwrites Search Console (unique partial index on the model).
// - googleSub arguments: a string = that Google account; undefined = "the user's only connection"
//   (AmbiguousConnectionError when there are several).
// - expiry_date is saved (the old code wrote a non-existent `expires` field).
// - GBP tokens are encrypted at rest (AES-256-GCM).

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

/** A user's connected Google account (one per token row). */
export interface ConnectionInfo {
	googleSub: string | null;
	googleEmail: string | null;
	status: 'active' | 'revoked';
	expiryDate: Date | null;
}

/** The user has several Google accounts connected and the caller did not say which one. */
export class AmbiguousConnectionError extends Error {
	constructor() {
		super('Several Google accounts are connected: specify which one (google_sub).');
		this.name = 'AmbiguousConnectionError';
	}
}

const encryptsType = (type: TokenType): boolean => type === tokenTypes.GBP;

export const createTokenStore = (crypto: TokenCrypto = tokenCrypto) => {
	const seal = (type: TokenType, value: string): string => (encryptsType(type) ? crypto.encrypt(value) : value);
	const open = (type: TokenType, value: string): string => (encryptsType(type) ? crypto.decrypt(value) : value);

	/** The active row for one connection (see the googleSub rules above). */
	const activeRow = async (userId: UserId, type: TokenType, googleSub?: string | null) => {
		if (googleSub !== undefined) {
			return UserAuth.findOne({ user_id: userId, token_type: type, is_active: true, google_sub: googleSub });
		}
		const rows = await UserAuth.find({ user_id: userId, token_type: type, is_active: true }).limit(2);
		if (rows.length > 1) throw new AmbiguousConnectionError();
		return rows[0] ?? null;
	};

	/** Every connection (Google account) of the user for this token type, oldest first. */
	const listConnections = async (userId: UserId, type: TokenType): Promise<ConnectionInfo[]> => {
		const rows = await UserAuth.find({ user_id: userId, token_type: type, is_active: true }).sort({ created_at: 1 }).lean();
		return rows.map((r) => ({
			googleSub: r.google_sub ?? null,
			googleEmail: r.google_email ?? null,
			status: r.status ?? 'active',
			expiryDate: r.expiry_date ?? null,
		}));
	};

	/** Decrypted tokens for one connection, or null when it does not exist. */
	const load = async (userId: UserId, type: TokenType, googleSub?: string | null): Promise<StoredTokens | null> => {
		const row = await activeRow(userId, type, googleSub);
		if (!row) return null;
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

	/**
	 * Creates or updates one connection (C17: filtered by token_type), keyed by update.googleSub (the
	 * Google account of the verified id_token).
	 */
	const save = async (userId: UserId, type: TokenType, update: TokenUpdate): Promise<void> => {
		const existing = await activeRow(userId, type, update.googleSub ?? undefined);
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
	const saveRefreshed = async (userId: UserId, type: TokenType, update: TokenUpdate, googleSub?: string | null): Promise<void> => {
		const row = await activeRow(userId, type, googleSub);
		if (!row) return;
		const set: Partial<IUserAuth> = {
			access_token: seal(type, update.accessToken),
			expiry_date: update.expiryDate as Date,
			last_refreshed_at: new Date(),
			last_error: null,
			updated_at: new Date(),
		};
		if (update.refreshToken) set.refresh_token = seal(type, update.refreshToken);
		await UserAuth.updateOne({ _id: row._id }, { $set: set });
	};

	/** True while the user has at least one usable (active, not revoked) connection of this type. */
	const hasUsableConnection = async (userId: UserId, type: TokenType): Promise<boolean> =>
		Boolean(await UserAuth.exists({ user_id: userId, token_type: type, is_active: true, status: { $ne: 'revoked' } }));

	const syncConnectedFlag = async (userId: UserId, type: TokenType): Promise<void> => {
		if (type !== tokenTypes.GBP) return;
		await User.updateOne({ _id: userId }, { $set: { is_gbp_connected: await hasUsableConnection(userId, type) } });
	};

	/** Google rejected this connection's refresh token (invalid_grant): that account must reconnect. */
	const markRevoked = async (userId: UserId, type: TokenType, message: string, googleSub?: string | null): Promise<void> => {
		const row = await activeRow(userId, type, googleSub);
		if (!row) return;
		await UserAuth.updateOne(
			{ _id: row._id },
			{ $set: { status: 'revoked', last_error: message.slice(0, 300), updated_at: new Date() } },
		);
		await syncConnectedFlag(userId, type);
	};

	/**
	 * Deletes one connection (googleSub given) or, with undefined, every
	 * connection of this type. Returns true if a row was removed.
	 */
	const remove = async (userId: UserId, type: TokenType, googleSub?: string | null): Promise<boolean> => {
		const filter: Record<string, unknown> = { user_id: userId, token_type: type };
		if (googleSub !== undefined) filter.google_sub = googleSub;
		const result = await UserAuth.deleteMany(filter);
		await syncConnectedFlag(userId, type);
		return result.deletedCount > 0;
	};

	return { load, save, saveRefreshed, markRevoked, remove, listConnections, hasUsableConnection };
};

export type TokenStore = ReturnType<typeof createTokenStore>;

export const tokenStore: TokenStore = createTokenStore();
