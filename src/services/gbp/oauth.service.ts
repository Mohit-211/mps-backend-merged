import crypto from 'crypto';
import { Types } from 'mongoose';
import httpStatus from 'http-status';
import config from '../../configs/config';
import logger from '../../configs/logger';
import { tokenTypes } from '../../configs/constantTypes';
import { GbpApiError, GbpClient, GbpConfigError, gbpClient } from '../../clients/gbpClient';
import { OAuthState, User } from '../../models';
import { ApiError } from '../../utils';
import { TokenStore, tokenStore } from './tokenStore';

// GBP OAuth connect flow (CLAUDE.md §10, AUDIT S11).
// The `state` is a random 32-byte token; only its SHA-256 hash is stored, with the user_id and a
// 10-minute expiry. The callback consumes it atomically (one use) and takes user_id from the stored
// row, never from the request, so a callback cannot bind a Google account to someone else's user.

export const GBP_SCOPE = 'https://www.googleapis.com/auth/business.manage';
export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const STATE_TTL_MS = 10 * 60 * 1000;

export const hashState = (state: string): string => crypto.createHash('sha256').update(state).digest('hex');

export interface CallbackQuery {
	code?: string;
	state?: string;
	error?: string;
}

export interface GbpOAuthDeps {
	client?: Pick<GbpClient, 'exchangeCode'>;
	tokens?: Pick<TokenStore, 'save'>;
	now?: () => Date;
	clientId?: string;
	redirectUri?: string;
}

export const createGbpOAuthService = (deps: GbpOAuthDeps = {}) => {
	const client = deps.client ?? gbpClient;
	const tokens = deps.tokens ?? tokenStore;
	const now = deps.now ?? (() => new Date());

	/** Stores a one-time state for the user and returns Google's consent URL. */
	const createAuthUrl = async (userId: Types.ObjectId | string): Promise<string> => {
		const clientId = deps.clientId ?? config.gbp.clientId;
		const redirectUri = deps.redirectUri ?? config.gbp.redirectUri;
		if (!clientId || !redirectUri) {
			throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Google Business Profile connection is not configured on this server.');
		}
		const state = crypto.randomBytes(32).toString('base64url');
		await OAuthState.create({
			token_hash: hashState(state),
			user_id: userId,
			purpose: 'gbp',
			expires_at: new Date(now().getTime() + STATE_TTL_MS),
		});
		const params = new URLSearchParams({
			client_id: clientId,
			redirect_uri: redirectUri,
			response_type: 'code',
			scope: GBP_SCOPE,
			access_type: 'offline',
			prompt: 'consent',
			include_granted_scopes: 'false',
			state,
		});
		return `${GOOGLE_AUTH_URL}?${params.toString()}`;
	};

	/** Validates and consumes the state, exchanges the code, stores the (encrypted) tokens. */
	const handleCallback = async (query: CallbackQuery): Promise<{ connected: true }> => {
		if (query.error) {
			throw new ApiError(
				httpStatus.BAD_REQUEST,
				query.error === 'access_denied'
					? 'Google Business Profile access was not granted.'
					: 'Google returned an error; start the connection again.',
			);
		}
		if (!query.code || !query.state) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid flow: code and state are required.');

		// Atomic one-time consume: unknown, expired and already-used states all fail here.
		const consumed = await OAuthState.findOneAndUpdate(
			{ token_hash: hashState(query.state), purpose: 'gbp', used_at: null, expires_at: { $gt: now() } },
			{ $set: { used_at: now() } },
		);
		if (!consumed) {
			throw new ApiError(httpStatus.BAD_REQUEST, 'This connection link is invalid or has expired. Start the connection again.');
		}
		const user = await User.findOne({ _id: consumed.user_id, is_active: true });
		if (!user) throw new ApiError(httpStatus.BAD_REQUEST, 'The user for this connection no longer exists.');

		let exchanged;
		try {
			exchanged = await client.exchangeCode(query.code);
		} catch (err) {
			if (err instanceof GbpConfigError) throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, err.message);
			if (err instanceof GbpApiError) {
				logger.warn(`gbp oauth: code exchange failed status=${err.status ?? '-'} reason=${err.reason ?? '-'}`);
				throw new ApiError(httpStatus.BAD_REQUEST, 'Google rejected the authorisation. Start the connection again.');
			}
			throw err;
		}
		await tokens.save(user._id, tokenTypes.GBP, {
			accessToken: exchanged.accessToken,
			refreshToken: exchanged.refreshToken,
			expiryDate: exchanged.expiryDate,
			scope: exchanged.scope,
		});
		await User.updateOne({ _id: user._id }, { $set: { is_gbp_connected: true } });
		logger.info(`gbp oauth: user ${String(user._id)} connected`);
		return { connected: true };
	};

	return { createAuthUrl, handleCallback };
};

export const gbpOAuthService = createGbpOAuthService();
