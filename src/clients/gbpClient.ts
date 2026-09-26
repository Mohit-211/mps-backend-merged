import { Types } from 'mongoose';
import config from '../configs/config';
import logger from '../configs/logger';
import { tokenTypes } from '../configs/constantTypes';
import { TokenStore, tokenStore as defaultTokenStore } from '../services/gbp/tokenStore';
import {
	HttpRequest,
	HttpRequestError,
	HttpTransport,
	Sleep,
	createAxiosTransport,
	defaultSleep,
	formBody,
	isTransportError,
	toHttpRequestError,
} from './http';
import {
	GbpAccount,
	GbpLocation,
	OAuthTokens,
	RawAccount,
	RawAccountsPage,
	RawLocation,
	RawLocationsPage,
	RawTokenResponse,
} from './types/gbp';

// Google Business Profile client (CLAUDE.md §10). Every GBP and OAuth call goes through here:
// - a per-client limiter (≤ GBP_MAX_RPS requests per second, default 5)
// - retries: 429 with backoff (up to 3 retries), 5xx / timeouts once; quota 0 and disabled APIs fail fast
// - per-user access tokens from the encrypted token store, refreshed when < 60 s remain or on a 401,
//   and persisted (a rotated refresh token is re-encrypted and stored)
// Logs carry the endpoint label, status, attempts and latency only: never tokens or payloads.

export const ACCOUNT_MANAGEMENT_URL = 'https://mybusinessaccountmanagement.googleapis.com/v1';
export const BUSINESS_INFORMATION_URL = 'https://mybusinessbusinessinformation.googleapis.com/v1';
export const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const OAUTH_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

export const DISCOVERY_READ_MASK =
	'name,title,storefrontAddress,serviceArea,phoneNumbers,websiteUri,categories,latlng,metadata,languageCode,profile';

const MAX_ACCOUNT_PAGES = 20;
const MAX_LOCATION_PAGES = 50;
const REFRESH_MARGIN_MS = 60_000;
const MAX_429_RETRIES = 3;
const MAX_OTHER_RETRIES = 1;
const BASE_429_DELAY_MS = 1000;

// ---- errors ----

/** Base class: a GBP or OAuth call failed. Carries only safe fields (never tokens). */
export class GbpApiError extends Error {
	readonly status?: number;
	readonly reason?: string;
	readonly apiCalls: number;
	constructor(message: string, source: { status?: number; reason?: string }, apiCalls: number) {
		super(message);
		this.name = 'GbpApiError';
		this.status = source.status;
		this.reason = source.reason;
		this.apiCalls = apiCalls;
	}
}

/** 429 with quota_limit_value 0: the Cloud project is not approved for the GBP APIs. */
export class GbpAccessNotApprovedError extends GbpApiError {
	constructor(source: HttpRequestError, apiCalls: number) {
		super(`GBP API access not approved (quota 0). ${source.message}`, source, apiCalls);
		this.name = 'GbpAccessNotApprovedError';
	}
}

/** 403 SERVICE_DISABLED: the API is not enabled in the Cloud project. The message names the API. */
export class GbpApiDisabledError extends GbpApiError {
	constructor(source: HttpRequestError, apiCalls: number) {
		super(`API not enabled in the Google Cloud project. ${source.message}`, source, apiCalls);
		this.name = 'GbpApiDisabledError';
	}
}

/** Google rejected the stored refresh token (invalid_grant): the user must reconnect. */
export class GbpReauthRequiredError extends GbpApiError {
	constructor(apiCalls: number) {
		super('Reconnect Google Business Profile: Google rejected the stored authorisation.', { status: 401, reason: 'invalid_grant' }, apiCalls);
		this.name = 'GbpReauthRequiredError';
	}
}

/** The user has no GBP connection. */
export class GbpNotConnectedError extends Error {
	constructor() {
		super('Google Business Profile is not connected for this user.');
		this.name = 'GbpNotConnectedError';
	}
}

/** GOOGLE_GBP_CLIENT_ID / SECRET / REDIRECT_URI missing. */
export class GbpConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'GbpConfigError';
	}
}

// ---- mapping ----

const str = (value: string | undefined): string | null => (value && value.length > 0 ? value : null);

export const mapAccount = (raw: RawAccount): GbpAccount | null =>
	raw.name
		? {
				name: raw.name,
				accountName: str(raw.accountName),
				type: str(raw.type),
				role: str(raw.role),
				verificationState: str(raw.verificationState),
			}
		: null;

export const mapLocation = (raw: RawLocation): GbpLocation | null => {
	if (!raw.name) return null;
	const address = raw.storefrontAddress;
	const lat = raw.latlng?.latitude;
	const lng = raw.latlng?.longitude;
	return {
		name: raw.name,
		title: str(raw.title),
		languageCode: str(raw.languageCode),
		storefrontAddress: address
			? {
					regionCode: str(address.regionCode),
					postalCode: str(address.postalCode),
					administrativeArea: str(address.administrativeArea),
					locality: str(address.locality),
					addressLines: (address.addressLines ?? []).filter((l) => l.trim().length > 0),
				}
			: null,
		serviceAreaRegionCode: str(raw.serviceArea?.regionCode),
		primaryPhone: str(raw.phoneNumbers?.primaryPhone),
		websiteUri: str(raw.websiteUri),
		primaryCategory: str(raw.categories?.primaryCategory?.displayName),
		latlng: typeof lat === 'number' && typeof lng === 'number' ? { latitude: lat, longitude: lng } : null,
		placeId: str(raw.metadata?.placeId),
		metadata: raw.metadata ?? null,
		profile: raw.profile ?? null,
	};
};

const mapTokens = (raw: RawTokenResponse, nowMs: number): OAuthTokens => {
	if (!raw.access_token) throw new GbpApiError('Google token response had no access_token', {}, 0);
	return {
		accessToken: raw.access_token,
		refreshToken: str(raw.refresh_token),
		expiryDate: new Date(nowMs + (raw.expires_in ?? 3600) * 1000),
		scope: str(raw.scope),
		idToken: str(raw.id_token),
	};
};

// ---- rate limiter ----

/** Sliding one-second window: at most `maxRps` calls start within any 1000 ms. Calls queue in order. */
export const createRateLimiter = (maxRps: number, now: () => number, sleep: Sleep) => {
	const starts: number[] = [];
	let chain: Promise<void> = Promise.resolve();
	const acquire = (): Promise<void> => {
		const next = chain.then(async () => {
			for (;;) {
				const t = now();
				while (starts.length > 0 && t - starts[0] >= 1000) starts.shift();
				if (starts.length < maxRps) {
					starts.push(t);
					return;
				}
				await sleep(1000 - (t - starts[0]));
			}
		});
		chain = next.catch(() => undefined);
		return next;
	};
	return { acquire };
};

// ---- client ----

export interface GbpClientOptions {
	transport?: HttpTransport;
	tokens?: Pick<TokenStore, 'load' | 'saveRefreshed' | 'markRevoked'>;
	clientId?: string;
	clientSecret?: string;
	redirectUri?: string;
	maxRps?: number;
	now?: () => number;
	sleep?: Sleep;
}

type UserId = Types.ObjectId | string;

/**
 * Which Google account to act as: the user's connection with this id_token sub (null = a pre-7a
 * connection without identity; undefined = the user's only connection).
 */
export interface ConnectionRef {
	userId: UserId;
	googleSub?: string | null;
}

export const createGbpClient = (options: GbpClientOptions = {}) => {
	const transport = options.transport ?? createAxiosTransport();
	const tokens = options.tokens ?? defaultTokenStore;
	const now = options.now ?? Date.now;
	const sleep = options.sleep ?? defaultSleep;
	const limiter = createRateLimiter(options.maxRps ?? config.gbp.maxRps, now, sleep);
	const stats = { calls: 0, byEndpoint: {} as Record<string, number> };

	const oauthConfig = () => {
		const clientId = options.clientId ?? config.gbp.clientId;
		const clientSecret = options.clientSecret ?? config.gbp.clientSecret;
		const redirectUri = options.redirectUri ?? config.gbp.redirectUri;
		if (!clientId || !clientSecret || !redirectUri) {
			throw new GbpConfigError('GOOGLE_GBP_CLIENT_ID, GOOGLE_GBP_CLIENT_SECRET and GOOGLE_GBP_REDIRECT_URI must be set');
		}
		return { clientId, clientSecret, redirectUri };
	};

	/** One logical request with rate limiting and the GBP retry policy. Returns the body and HTTP calls made. */
	const send = async <T>(label: string, request: HttpRequest): Promise<{ data: T; calls: number }> => {
		let calls = 0;
		let otherRetries = 0;
		let rateRetries = 0;
		for (;;) {
			await limiter.acquire();
			const started = now();
			calls += 1;
			stats.calls += 1;
			stats.byEndpoint[label] = (stats.byEndpoint[label] ?? 0) + 1;
			try {
				const response = await transport<T>(request);
				logger.debug(`gbp ${label} status=${response.status} attempt=${calls} ${now() - started}ms`);
				return { data: response.data, calls };
			} catch (err) {
				if (!isTransportError(err)) throw err;
				const error = toHttpRequestError(err);
				logger.debug(`gbp ${label} status=${error.status ?? error.code} reason=${error.reason ?? '-'} attempt=${calls}`);
				if (error.status === 429 && error.quotaLimitValue === '0') throw new GbpAccessNotApprovedError(error, calls);
				if (error.status === 403 && (error.reason === 'SERVICE_DISABLED' || error.reason === 'accessNotConfigured')) {
					throw new GbpApiDisabledError(error, calls);
				}
				if (error.status === 429 && rateRetries < MAX_429_RETRIES) {
					const backoff = BASE_429_DELAY_MS * 2 ** rateRetries;
					rateRetries += 1;
					await sleep(Math.max(backoff, error.retryAfterMs ?? 0));
					continue;
				}
				if (error.retryable && error.status !== 429 && otherRetries < MAX_OTHER_RETRIES) {
					otherRetries += 1;
					await sleep(500 * otherRetries);
					continue;
				}
				const failure = new GbpApiError(`GBP ${label} failed: ${error.message}`, error, calls);
				Object.assign(failure, { cause: error });
				throw failure;
			}
		}
	};

	const tokenRequest = async (fields: Record<string, string>, label: string): Promise<RawTokenResponse> => {
		const { data } = await send<RawTokenResponse>(label, {
			method: 'POST',
			url: OAUTH_TOKEN_URL,
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			data: formBody(fields),
		});
		return data;
	};

	/**
	 * Exchanges an authorisation code for tokens. The redirect flow uses the configured redirect URI;
	 * the Google Identity Services popup flow must use "postmessage".
	 */
	const exchangeCode = async (code: string, redirectUriOverride?: string): Promise<OAuthTokens> => {
		const { clientId, clientSecret, redirectUri } = oauthConfig();
		const raw = await tokenRequest(
			{
				code,
				client_id: clientId,
				client_secret: clientSecret,
				redirect_uri: redirectUriOverride ?? redirectUri,
				grant_type: 'authorization_code',
			},
			'oauth.exchange',
		);
		return mapTokens(raw, now());
	};

	/** Revokes a token at Google (the token goes in the POST body, never the URL). */
	const revoke = async (token: string): Promise<void> => {
		await send('oauth.revoke', {
			method: 'POST',
			url: OAUTH_REVOKE_URL,
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			data: formBody({ token }),
		});
	};

	/** Valid access token for a connection: refreshed (and persisted) when < 60 s remain, or when forced. */
	const getAccessToken = async (conn: ConnectionRef, force = false): Promise<string> => {
		const { userId, googleSub } = conn;
		const stored = await tokens.load(userId, tokenTypes.GBP, googleSub);
		if (!stored) throw new GbpNotConnectedError();
		if (stored.status === 'revoked') throw new GbpReauthRequiredError(0);
		const fresh = stored.expiryDate !== null && stored.expiryDate.getTime() - now() > REFRESH_MARGIN_MS;
		if (fresh && !force) return stored.accessToken;

		const { clientId, clientSecret } = oauthConfig();
		let raw: RawTokenResponse;
		try {
			raw = await tokenRequest(
				{ client_id: clientId, client_secret: clientSecret, refresh_token: stored.refreshToken, grant_type: 'refresh_token' },
				'oauth.refresh',
			);
		} catch (err) {
			if (err instanceof GbpApiError && err.reason === 'invalid_grant') {
				await tokens.markRevoked(userId, tokenTypes.GBP, err.message, googleSub ?? stored.googleSub);
				throw new GbpReauthRequiredError(err.apiCalls);
			}
			throw err;
		}
		const refreshed = mapTokens(raw, now());
		await tokens.saveRefreshed(
			userId,
			tokenTypes.GBP,
			{
				accessToken: refreshed.accessToken,
				refreshToken: refreshed.refreshToken, // rotation: stored (encrypted) only when Google sent a new one
				expiryDate: refreshed.expiryDate,
			},
			googleSub ?? stored.googleSub,
		);
		return refreshed.accessToken;
	};

	/** Authenticated GET for a connection; on a 401, refreshes once and retries. */
	const authedGet = async <T>(conn: ConnectionRef, label: string, url: string): Promise<T> => {
		const attempt = async (token: string): Promise<T> =>
			(await send<T>(label, { method: 'GET', url, headers: { Authorization: `Bearer ${token}` } })).data;
		try {
			return await attempt(await getAccessToken(conn));
		} catch (err) {
			if (err instanceof GbpApiError && err.status === 401 && !(err instanceof GbpReauthRequiredError)) {
				return attempt(await getAccessToken(conn, true));
			}
			throw err;
		}
	};

	const withQuery = (base: string, params: Record<string, string | undefined>): string => {
		const query = Object.entries(params)
			.filter((entry): entry is [string, string] => entry[1] !== undefined)
			.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
			.join('&');
		return query ? `${base}?${query}` : base;
	};

	/** Every account the connection's Google account can access (all pages). */
	const listAccounts = async (conn: ConnectionRef): Promise<GbpAccount[]> => {
		const accounts: GbpAccount[] = [];
		let pageToken: string | undefined;
		for (let page = 0; page < MAX_ACCOUNT_PAGES; page++) {
			const url = withQuery(`${ACCOUNT_MANAGEMENT_URL}/accounts`, { pageSize: '20', pageToken });
			const data = await authedGet<RawAccountsPage>(conn, 'accounts.list', url);
			for (const raw of data.accounts ?? []) {
				const account = mapAccount(raw);
				if (account) accounts.push(account);
			}
			pageToken = data.nextPageToken;
			if (!pageToken) return accounts;
		}
		logger.warn(`gbp accounts.list stopped at the ${MAX_ACCOUNT_PAGES}-page cap`);
		return accounts;
	};

	/** Every location of one account (all pages), with the discovery readMask. */
	const listLocations = async (conn: ConnectionRef, accountName: string): Promise<GbpLocation[]> => {
		const locations: GbpLocation[] = [];
		let pageToken: string | undefined;
		for (let page = 0; page < MAX_LOCATION_PAGES; page++) {
			const url = withQuery(`${BUSINESS_INFORMATION_URL}/${accountName}/locations`, {
				readMask: DISCOVERY_READ_MASK,
				pageSize: '100',
				pageToken,
			});
			const data = await authedGet<RawLocationsPage>(conn, 'locations.list', url);
			for (const raw of data.locations ?? []) {
				const location = mapLocation(raw);
				if (location) locations.push(location);
			}
			pageToken = data.nextPageToken;
			if (!pageToken) return locations;
		}
		logger.warn(`gbp locations.list stopped at the ${MAX_LOCATION_PAGES}-page cap`);
		return locations;
	};

	/** One location ("locations/123"); fails if the user's Google account cannot access it. */
	const getLocation = async (conn: ConnectionRef, locationName: string, readMask = DISCOVERY_READ_MASK): Promise<GbpLocation> => {
		const raw = await authedGet<RawLocation>(conn, 'locations.get', withQuery(`${BUSINESS_INFORMATION_URL}/${locationName}`, { readMask }));
		const location = mapLocation(raw);
		if (!location) throw new GbpApiError('GBP locations.get returned no location name', {}, 1);
		return location;
	};

	const getStats = () => ({ calls: stats.calls, byEndpoint: { ...stats.byEndpoint } });

	return { exchangeCode, revoke, getAccessToken, listAccounts, listLocations, getLocation, getStats };
};

export type GbpClient = ReturnType<typeof createGbpClient>;

export const gbpClient: GbpClient = createGbpClient();
