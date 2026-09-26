import crypto from 'crypto';
import { Types } from 'mongoose';
import httpStatus from 'http-status';
import config from '../../configs/config';
import logger from '../../configs/logger';
import { tokenTypes } from '../../configs/constantTypes';
import { GbpApiError, GbpClient, GbpConfigError, gbpClient } from '../../clients/gbpClient';
import { OAuthFlow, OAuthState, User, UserGBP } from '../../models';
import { ApiError } from '../../utils';
import { IdTokenError, IdTokenVerifier, verifyGoogleIdToken } from './idToken';
import { TokenStore, tokenStore } from './tokenStore';

// GBP OAuth connect (CLAUDE.md §10, AUDIT S11; popup flow Phase 7a).
// - The `state` is a random 32-byte token; only its SHA-256 hash is stored with user_id, the flow
//   ('redirect' | 'popup') and a 10-minute expiry. It is consumed atomically, once, by its own flow.
//   The popup flow also requires the state to belong to the logged-in user.
// - Scopes: openid, email, business.manage. The id_token is verified (signature, issuer, audience,
//   expiry, email_verified) and the Google email is stored for "Connected as …".
// - Any Google account may connect. Switching to a different Google account while locations are
//   bound is refused (409): those bindings belong to the old account.

export const GBP_SCOPE = 'https://www.googleapis.com/auth/business.manage';
export const GBP_SCOPES = ['openid', 'email', GBP_SCOPE];
export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const POPUP_REDIRECT_URI = 'postmessage';
export const CONNECT_PROMPT = 'select_account consent';
export const STATE_TTL_MS = 10 * 60 * 1000;

export const hashState = (state: string): string => crypto.createHash('sha256').update(state).digest('hex');

export interface CallbackQuery {
	code?: string;
	state?: string;
	error?: string;
}

/** What the frontend passes to google.accounts.oauth2.initCodeClient (popup mode). */
export interface PopupConfig {
	client_id: string;
	scope: string;
	state: string;
	ux_mode: 'popup';
	select_account: true;
	prompt: string;
	access_type: 'offline';
}

export interface ConnectResult {
	connected: true;
	google_email: string;
}

export interface GbpOAuthDeps {
	client?: Pick<GbpClient, 'exchangeCode'>;
	tokens?: Pick<TokenStore, 'save' | 'load'>;
	verifyIdToken?: IdTokenVerifier;
	now?: () => Date;
	clientId?: string;
	redirectUri?: string;
}

type UserId = Types.ObjectId | string;

export const createGbpOAuthService = (deps: GbpOAuthDeps = {}) => {
	const client = deps.client ?? gbpClient;
	const tokens = deps.tokens ?? tokenStore;
	const verifyIdToken = deps.verifyIdToken ?? verifyGoogleIdToken;
	const now = deps.now ?? (() => new Date());

	const oauthClientId = (): string => {
		const clientId = deps.clientId ?? config.gbp.clientId;
		if (!clientId) {
			throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Google Business Profile connection is not configured on this server.');
		}
		return clientId;
	};

	const newState = async (userId: UserId, flow: OAuthFlow): Promise<string> => {
		const state = crypto.randomBytes(32).toString('base64url');
		await OAuthState.create({
			token_hash: hashState(state),
			user_id: userId,
			purpose: 'gbp',
			flow,
			expires_at: new Date(now().getTime() + STATE_TTL_MS),
		});
		return state;
	};

	/** Redirect flow (fallback): Google's consent URL with a one-time state. */
	const createAuthUrl = async (userId: UserId): Promise<string> => {
		const clientId = oauthClientId();
		const redirectUri = deps.redirectUri ?? config.gbp.redirectUri;
		if (!redirectUri) {
			throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Google Business Profile connection is not configured on this server.');
		}
		const params = new URLSearchParams({
			client_id: clientId,
			redirect_uri: redirectUri,
			response_type: 'code',
			scope: GBP_SCOPES.join(' '),
			access_type: 'offline',
			prompt: CONNECT_PROMPT,
			include_granted_scopes: 'false',
			state: await newState(userId, 'redirect'),
		});
		return `${GOOGLE_AUTH_URL}?${params.toString()}`;
	};

	/** Popup flow: config for the Google Identity Services code client, with a one-time state. */
	const createPopupConfig = async (userId: UserId): Promise<PopupConfig> => ({
		client_id: oauthClientId(),
		scope: GBP_SCOPES.join(' '),
		state: await newState(userId, 'popup'),
		ux_mode: 'popup',
		select_account: true,
		prompt: CONNECT_PROMPT,
		access_type: 'offline',
	});

	/** Atomic one-time consume: unknown, expired, used, wrong-flow (and, for popup, wrong-user) states fail. */
	const consumeState = async (state: string, flow: OAuthFlow, userId?: UserId) => {
		const filter: Record<string, unknown> = {
			token_hash: hashState(state),
			purpose: 'gbp',
			flow: flow === 'redirect' ? { $in: ['redirect', null] } : 'popup',
			used_at: null,
			expires_at: { $gt: now() },
		};
		if (userId) filter.user_id = userId;
		const consumed = await OAuthState.findOneAndUpdate(filter, { $set: { used_at: now() } });
		if (!consumed) {
			throw new ApiError(httpStatus.BAD_REQUEST, 'This connection link is invalid or has expired. Start the connection again.');
		}
		return consumed;
	};

	/** Exchange, verify the id_token, apply the account-switch rule, store tokens + identity. */
	const finishConnect = async (userId: UserId, code: string, redirectUri?: string): Promise<ConnectResult> => {
		const user = await User.findOne({ _id: userId, is_active: true });
		if (!user) throw new ApiError(httpStatus.BAD_REQUEST, 'The user for this connection no longer exists.');

		let exchanged;
		try {
			exchanged = await client.exchangeCode(code, redirectUri);
		} catch (err) {
			if (err instanceof GbpConfigError) throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, err.message);
			if (err instanceof GbpApiError) {
				logger.warn(`gbp oauth: code exchange failed status=${err.status ?? '-'} reason=${err.reason ?? '-'}`);
				throw new ApiError(httpStatus.BAD_REQUEST, 'Google rejected the authorisation. Start the connection again.');
			}
			throw err;
		}

		let identity;
		try {
			identity = await verifyIdToken(exchanged.idToken);
		} catch (err) {
			if (err instanceof IdTokenError) {
				logger.warn(`gbp oauth: ${err.message}`);
				throw new ApiError(httpStatus.BAD_REQUEST, 'Could not verify the Google account. Start the connection again.');
			}
			throw err;
		}

		const existing = await tokens.load(user._id, tokenTypes.GBP).catch(() => null);
		const switching = existing !== null && existing.googleSub !== null && existing.googleSub !== identity.sub;
		if (switching) {
			const bound = await UserGBP.countDocuments({ user_id: user._id, is_active: true });
			if (bound > 0) {
				throw new ApiError(
					httpStatus.CONFLICT,
					`Connected as ${existing.googleEmail ?? 'another Google account'} with ${bound} bound location(s). Disconnect first to switch Google accounts.`,
				);
			}
		}
		if (!exchanged.refreshToken && (existing === null || switching)) {
			throw new ApiError(
				httpStatus.BAD_REQUEST,
				'Google did not return a refresh token. Remove MyPageSEO at myaccount.google.com/permissions and connect again.',
			);
		}

		await tokens.save(user._id, tokenTypes.GBP, {
			accessToken: exchanged.accessToken,
			refreshToken: exchanged.refreshToken,
			expiryDate: exchanged.expiryDate,
			scope: exchanged.scope,
			googleEmail: identity.email,
			googleSub: identity.sub,
		});
		await User.updateOne({ _id: user._id }, { $set: { is_gbp_connected: true } });
		logger.info(`gbp oauth: user ${String(user._id)} connected`);
		return { connected: true, google_email: identity.email };
	};

	/** Redirect flow callback (Google calls it; no MyPageSEO session). */
	const handleCallback = async (query: CallbackQuery): Promise<ConnectResult> => {
		if (query.error) {
			throw new ApiError(
				httpStatus.BAD_REQUEST,
				query.error === 'access_denied'
					? 'Google Business Profile access was not granted.'
					: 'Google returned an error; start the connection again.',
			);
		}
		if (!query.code || !query.state) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid flow: code and state are required.');
		const consumed = await consumeState(query.state, 'redirect');
		return finishConnect(consumed.user_id, query.code);
	};

	/** Popup flow: the logged-in user posts the code + state from the GIS code client. */
	const handlePopupCode = async (userId: UserId, body: { code?: string; state?: string }): Promise<ConnectResult> => {
		if (!body.code || !body.state) throw new ApiError(httpStatus.BAD_REQUEST, 'code and state are required.');
		const consumed = await consumeState(body.state, 'popup', userId);
		return finishConnect(consumed.user_id, body.code, POPUP_REDIRECT_URI);
	};

	return { createAuthUrl, createPopupConfig, handleCallback, handlePopupCode };
};

export const gbpOAuthService = createGbpOAuthService();
