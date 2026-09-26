import axios from 'axios';

// Shared HTTP plumbing for third-party API clients (Places now, GBP in Phase 6).
// Requests go through a pluggable transport so tests can replay fixtures without a network.
// Errors are normalised into HttpRequestError, which never keeps request headers or config
// (that is where API keys live), so an error can be logged or rethrown safely.

export const DEFAULT_TIMEOUT_MS = 15000;
const MAX_ERROR_MESSAGE_LENGTH = 300;
const MAX_RETRY_AFTER_MS = 5000;

export interface HttpRequest {
	method: 'GET' | 'POST' | 'DELETE';
	url: string;
	headers: Record<string, string>;
	data?: unknown;
}

export interface HttpResponse<T> {
	status: number;
	data: T;
}

export type HttpTransport = <T>(request: HttpRequest) => Promise<HttpResponse<T>>;

export type HttpErrorCode = 'HTTP_ERROR' | 'TIMEOUT' | 'NETWORK_ERROR';

export class HttpRequestError extends Error {
	readonly status?: number;
	readonly apiStatus?: string;
	readonly code: HttpErrorCode;
	readonly retryable: boolean;
	readonly retryAfterMs?: number;
	/** Google ErrorInfo reason (e.g. SERVICE_DISABLED, RATE_LIMIT_EXCEEDED) or OAuth error code (invalid_grant). */
	readonly reason?: string;
	/** ErrorInfo metadata.quota_limit_value: "0" means the API is not approved for this project. */
	readonly quotaLimitValue?: string;
	attempts = 1;

	constructor(params: {
		message: string;
		code: HttpErrorCode;
		status?: number;
		apiStatus?: string;
		retryAfterMs?: number;
		reason?: string;
		quotaLimitValue?: string;
	}) {
		super(params.message);
		this.name = 'HttpRequestError';
		this.code = params.code;
		this.status = params.status;
		this.apiStatus = params.apiStatus;
		this.retryAfterMs = params.retryAfterMs;
		this.reason = params.reason;
		this.quotaLimitValue = params.quotaLimitValue;
		this.retryable = isRetryable(params.status, params.code);
	}
}

// Retry on rate limits, server errors, timeouts and network failures; never on other 4xx.
export const isRetryable = (status: number | undefined, code: HttpErrorCode): boolean => {
	if (code === 'TIMEOUT' || code === 'NETWORK_ERROR') return true;
	if (status === undefined) return false;
	return status === 429 || status >= 500;
};

interface GoogleErrorDetail {
	reason?: string;
	metadata?: Record<string, string>;
}

interface GoogleErrorBody {
	// Google APIs: { error: { code, message, status, details } }. OAuth endpoints: { error: 'invalid_grant', error_description }.
	error?: { code?: number; message?: string; status?: string; details?: GoogleErrorDetail[] } | string;
	error_description?: string;
}

const truncate = (text: string): string =>
	text.length > MAX_ERROR_MESSAGE_LENGTH ? `${text.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…` : text;

const parseRetryAfter = (value: unknown): number | undefined => {
	const seconds = Number(value);
	return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS) : undefined;
};

/** True for errors produced by a transport (axios or HttpRequestError), as opposed to programming errors. */
export const isTransportError = (err: unknown): boolean =>
	err instanceof HttpRequestError || axios.isAxiosError(err);

/**
 * Safe error from an HTTP error response. Keeps only the status, the API's error status, message,
 * ErrorInfo reason and quota_limit_value; never the request, headers or the rest of the payload.
 */
export const httpErrorFromResponse = (status: number, rawBody: unknown, retryAfter?: unknown): HttpRequestError => {
	const body = (rawBody && typeof rawBody === 'object' ? rawBody : {}) as GoogleErrorBody;
	if (typeof body.error === 'string') {
		return new HttpRequestError({
			code: 'HTTP_ERROR',
			status,
			reason: body.error,
			message: truncate(`${body.error}${body.error_description ? `: ${body.error_description}` : ''}`),
			retryAfterMs: parseRetryAfter(retryAfter),
		});
	}
	const error = body.error;
	const details = Array.isArray(error?.details) ? error.details : [];
	const reason = details.find((d) => typeof d?.reason === 'string')?.reason;
	const quotaLimitValue = details.find((d) => d?.metadata?.quota_limit_value !== undefined)?.metadata?.quota_limit_value;
	return new HttpRequestError({
		code: 'HTTP_ERROR',
		status,
		apiStatus: error?.status,
		reason,
		quotaLimitValue,
		message: truncate(error?.message || `Request failed with status ${status}`),
		retryAfterMs: parseRetryAfter(retryAfter),
	});
};

/** application/x-www-form-urlencoded body (OAuth token and revoke endpoints). */
export const formBody = (fields: Record<string, string>): string => new URLSearchParams(fields).toString();

// Builds a safe error from anything axios (or a transport) throws. Only status, the API's own
// error status/message and the error code survive; headers, URL and request config are dropped.
export const toHttpRequestError = (err: unknown): HttpRequestError => {
	if (err instanceof HttpRequestError) return err;
	if (axios.isAxiosError(err)) {
		if (err.response) {
			return httpErrorFromResponse(err.response.status, err.response.data, err.response.headers?.['retry-after']);
		}
		const timedOut = err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || err.code === 'ERR_CANCELED';
		return new HttpRequestError({
			code: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR',
			message: timedOut ? 'Request timed out' : `Network error${err.code ? ` (${err.code})` : ''}`,
		});
	}
	return new HttpRequestError({ code: 'NETWORK_ERROR', message: 'Unexpected transport failure' });
};

export const createAxiosTransport = (timeoutMs: number = DEFAULT_TIMEOUT_MS): HttpTransport => {
	const instance = axios.create({ timeout: timeoutMs });
	return async <T>(request: HttpRequest): Promise<HttpResponse<T>> => {
		try {
			const response = await instance.request<T>({
				method: request.method,
				url: request.url,
				headers: request.headers,
				data: request.data,
			});
			return { status: response.status, data: response.data };
		} catch (err) {
			throw toHttpRequestError(err);
		}
	};
};

export type Sleep = (ms: number) => Promise<void>;
export const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export interface RetryOptions {
	retries?: number;
	baseDelayMs?: number;
	sleep?: Sleep;
}

export interface RetryResult<T> {
	value: T;
	attempts: number;
}

// Runs fn, retrying up to `retries` times (default 1) on retryable errors with jittered
// exponential backoff (honouring Retry-After up to 5 s). The thrown error carries `attempts`.
// Errors that did not come from a transport (programming errors) are rethrown untouched, never retried.
export const withRetry = async <T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<RetryResult<T>> => {
	const retries = options.retries ?? 1;
	const baseDelayMs = options.baseDelayMs ?? 500;
	const sleep = options.sleep ?? defaultSleep;
	for (let attempt = 1; ; attempt++) {
		try {
			return { value: await fn(), attempts: attempt };
		} catch (err) {
			if (!isTransportError(err)) throw err;
			const error = toHttpRequestError(err);
			error.attempts = attempt;
			if (!error.retryable || attempt > retries) throw error;
			const backoff = baseDelayMs * 2 ** (attempt - 1) + Math.floor(Math.random() * (baseDelayMs / 2));
			await sleep(Math.max(backoff, error.retryAfterMs ?? 0));
		}
	}
};
