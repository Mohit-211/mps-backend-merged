import axios from 'axios';

// Shared HTTP plumbing for third-party API clients (Places now, GBP in Phase 6).
// Requests go through a pluggable transport so tests can replay fixtures without a network.
// Errors are normalised into HttpRequestError, which never keeps request headers or config
// (that is where API keys live), so an error can be logged or rethrown safely.

export const DEFAULT_TIMEOUT_MS = 15000;
const MAX_ERROR_MESSAGE_LENGTH = 300;
const MAX_RETRY_AFTER_MS = 5000;

export interface HttpRequest {
	method: 'GET' | 'POST';
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
	attempts = 1;

	constructor(params: {
		message: string;
		code: HttpErrorCode;
		status?: number;
		apiStatus?: string;
		retryAfterMs?: number;
	}) {
		super(params.message);
		this.name = 'HttpRequestError';
		this.code = params.code;
		this.status = params.status;
		this.apiStatus = params.apiStatus;
		this.retryAfterMs = params.retryAfterMs;
		this.retryable = isRetryable(params.status, params.code);
	}
}

// Retry on rate limits, server errors, timeouts and network failures; never on other 4xx.
export const isRetryable = (status: number | undefined, code: HttpErrorCode): boolean => {
	if (code === 'TIMEOUT' || code === 'NETWORK_ERROR') return true;
	if (status === undefined) return false;
	return status === 429 || status >= 500;
};

interface GoogleErrorBody {
	error?: { code?: number; message?: string; status?: string };
}

const truncate = (text: string): string =>
	text.length > MAX_ERROR_MESSAGE_LENGTH ? `${text.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…` : text;

const parseRetryAfter = (value: unknown): number | undefined => {
	const seconds = Number(value);
	return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS) : undefined;
};

// Builds a safe error from anything axios (or a transport) throws. Only status, the API's own
// error status/message and the error code survive; headers, URL and request config are dropped.
export const toHttpRequestError = (err: unknown): HttpRequestError => {
	if (err instanceof HttpRequestError) return err;
	if (axios.isAxiosError(err)) {
		if (err.response) {
			const body = err.response.data as GoogleErrorBody | undefined;
			return new HttpRequestError({
				code: 'HTTP_ERROR',
				status: err.response.status,
				apiStatus: body?.error?.status,
				message: truncate(body?.error?.message || `Request failed with status ${err.response.status}`),
				retryAfterMs: parseRetryAfter(err.response.headers?.['retry-after']),
			});
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
export const withRetry = async <T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<RetryResult<T>> => {
	const retries = options.retries ?? 1;
	const baseDelayMs = options.baseDelayMs ?? 500;
	const sleep = options.sleep ?? defaultSleep;
	for (let attempt = 1; ; attempt++) {
		try {
			return { value: await fn(), attempts: attempt };
		} catch (err) {
			const error = toHttpRequestError(err);
			error.attempts = attempt;
			if (!error.retryable || attempt > retries) throw error;
			const backoff = baseDelayMs * 2 ** (attempt - 1) + Math.floor(Math.random() * (baseDelayMs / 2));
			await sleep(Math.max(backoff, error.retryAfterMs ?? 0));
		}
	}
};
