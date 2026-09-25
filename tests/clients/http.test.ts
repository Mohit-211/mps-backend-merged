import http from 'http';
import { AddressInfo } from 'net';
import { AxiosError, AxiosHeaders } from 'axios';
import {
	HttpRequestError,
	createAxiosTransport,
	isRetryable,
	toHttpRequestError,
	withRetry,
} from '../../src/clients/http';

const SENTINEL_KEY = 'TEST_KEY_SENTINEL_do_not_leak';
const noSleep = async (): Promise<void> => undefined;

const httpError = (status: number): HttpRequestError =>
	new HttpRequestError({ code: 'HTTP_ERROR', status, message: `status ${status}` });

describe('isRetryable', () => {
	it.each([
		[429, 'HTTP_ERROR', true],
		[500, 'HTTP_ERROR', true],
		[503, 'HTTP_ERROR', true],
		[400, 'HTTP_ERROR', false],
		[403, 'HTTP_ERROR', false],
		[404, 'HTTP_ERROR', false],
		[undefined, 'TIMEOUT', true],
		[undefined, 'NETWORK_ERROR', true],
	] as const)('status %s / %s → %s', (status, code, expected) => {
		expect(isRetryable(status, code)).toBe(expected);
	});
});

describe('withRetry', () => {
	it('returns on the first success with attempts = 1', async () => {
		const result = await withRetry(async () => 'ok', { sleep: noSleep });
		expect(result).toEqual({ value: 'ok', attempts: 1 });
	});

	it('retries once after a 503 and succeeds', async () => {
		const fn = jest.fn().mockRejectedValueOnce(httpError(503)).mockResolvedValueOnce('ok');
		const result = await withRetry(fn, { sleep: noSleep });
		expect(result).toEqual({ value: 'ok', attempts: 2 });
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it('gives up after one retry and reports 2 attempts', async () => {
		const fn = jest.fn().mockRejectedValue(httpError(500));
		await expect(withRetry(fn, { sleep: noSleep })).rejects.toMatchObject({ status: 500, attempts: 2 });
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it('does not retry a 400', async () => {
		const fn = jest.fn().mockRejectedValue(httpError(400));
		await expect(withRetry(fn, { sleep: noSleep })).rejects.toMatchObject({ status: 400, attempts: 1 });
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('waits at least Retry-After (capped) before retrying a 429', async () => {
		const sleep = jest.fn(async (ms: number): Promise<void> => void ms);
		const rateLimited = new HttpRequestError({ code: 'HTTP_ERROR', status: 429, message: 'slow down', retryAfterMs: 3000 });
		const fn = jest.fn().mockRejectedValueOnce(rateLimited).mockResolvedValueOnce('ok');
		await withRetry(fn, { sleep });
		expect(sleep).toHaveBeenCalledWith(expect.any(Number));
		expect(sleep.mock.calls[0][0]).toBeGreaterThanOrEqual(3000);
	});
});

describe('toHttpRequestError', () => {
	it('keeps the Google error status/message and drops headers and config', () => {
		const headers = new AxiosHeaders({ 'X-Goog-Api-Key': SENTINEL_KEY });
		const axiosError = new AxiosError('Request failed', 'ERR_BAD_REQUEST', { headers, url: `https://example.test/?key=${SENTINEL_KEY}` }, null, {
			status: 403,
			statusText: 'Forbidden',
			headers: {},
			config: { headers },
			data: { error: { code: 403, status: 'PERMISSION_DENIED', message: 'API key not valid.' } },
		});
		const error = toHttpRequestError(axiosError);
		expect(error).toMatchObject({ status: 403, apiStatus: 'PERMISSION_DENIED', message: 'API key not valid.', retryable: false });
		const serialised = JSON.stringify(error) + String(error) + (error.stack ?? '');
		expect(serialised).not.toContain(SENTINEL_KEY);
	});

	it('maps an axios timeout to a retryable TIMEOUT error', () => {
		const error = toHttpRequestError(new AxiosError('timeout of 10ms exceeded', 'ECONNABORTED'));
		expect(error).toMatchObject({ code: 'TIMEOUT', retryable: true });
	});
});

describe('createAxiosTransport', () => {
	let server: http.Server;
	let baseUrl: string;

	beforeAll(async () => {
		// Local server that never answers /hang and returns a Google-style error on /fail.
		server = http.createServer((req, res) => {
			if (req.url === '/fail') {
				res.writeHead(500, { 'content-type': 'application/json' });
				res.end(JSON.stringify({ error: { code: 500, status: 'INTERNAL', message: 'backend error' } }));
			}
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	});

	afterAll(async () => {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	it('times out and throws a TIMEOUT HttpRequestError', async () => {
		const transport = createAxiosTransport(100);
		await expect(transport({ method: 'GET', url: `${baseUrl}/hang`, headers: {} })).rejects.toMatchObject({
			code: 'TIMEOUT',
			retryable: true,
		});
	});

	it('normalises an HTTP error response', async () => {
		const transport = createAxiosTransport(1000);
		await expect(
			transport({ method: 'POST', url: `${baseUrl}/fail`, headers: { 'X-Goog-Api-Key': SENTINEL_KEY }, data: {} }),
		).rejects.toMatchObject({ status: 500, apiStatus: 'INTERNAL', retryable: true });
	});
});

describe('withRetry and programming errors', () => {
	it('rethrows non-transport errors untouched without retrying', async () => {
		const bug = new TypeError('not a transport failure');
		const fn = jest.fn().mockRejectedValue(bug);
		await expect(withRetry(fn, { sleep: noSleep })).rejects.toBe(bug);
		expect(fn).toHaveBeenCalledTimes(1);
	});
});
