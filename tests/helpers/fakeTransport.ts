import fs from 'fs';
import path from 'path';
import { HttpRequest, HttpRequestError, HttpResponse, HttpTransport } from '../../src/clients/http';

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/places');

export const loadPlacesFixture = <T = unknown>(name: string): T =>
	JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, `${name}.json`), 'utf8')) as T;

export const placeIds = loadPlacesFixture<{ target: string; competitor: string; movedFrom: string }>('ids');

/** One scripted reply: an HTTP status plus a fixture name (or inline body), or a network failure. */
export type FakeStep =
	| { status: number; fixture: string }
	| { status: number; body: unknown }
	| { networkError: 'TIMEOUT' | 'NETWORK_ERROR' };

export interface FakeTransport {
	transport: HttpTransport;
	requests: HttpRequest[];
	remaining: () => number;
}

/**
 * Transport that replays scripted steps in order and records every request.
 * Non-2xx steps are thrown as HttpRequestError, the same way the axios transport behaves.
 */
export const createFakeTransport = (steps: FakeStep[]): FakeTransport => {
	const queue = [...steps];
	const requests: HttpRequest[] = [];
	const transport: HttpTransport = async <T>(request: HttpRequest): Promise<HttpResponse<T>> => {
		requests.push(JSON.parse(JSON.stringify(request)) as HttpRequest);
		const step = queue.shift();
		if (!step) throw new Error(`Fake transport: unexpected request #${requests.length} (no scripted step left)`);
		if ('networkError' in step) {
			throw new HttpRequestError({ code: step.networkError, message: `simulated ${step.networkError}` });
		}
		const body = 'fixture' in step ? loadPlacesFixture(step.fixture) : step.body;
		if (step.status >= 400) {
			const error = (body as { error?: { status?: string; message?: string } }).error;
			throw new HttpRequestError({
				code: 'HTTP_ERROR',
				status: step.status,
				apiStatus: error?.status,
				message: error?.message ?? `status ${step.status}`,
			});
		}
		return { status: step.status, data: body as T };
	};
	return { transport, requests, remaining: () => queue.length };
};
