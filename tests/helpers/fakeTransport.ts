import fs from 'fs';
import path from 'path';
import { HttpRequest, HttpRequestError, HttpResponse, HttpTransport, httpErrorFromResponse } from '../../src/clients/http';

const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures');

export const loadPlacesFixture = <T = unknown>(name: string): T =>
	JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, 'places', `${name}.json`), 'utf8')) as T;

export const loadGbpFixture = <T = unknown>(name: string): T =>
	JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, 'gbp', `${name}.json`), 'utf8')) as T;

/** "gbp/<name>" loads from fixtures/gbp; a bare name loads from fixtures/places. */
const loadFixture = (name: string): unknown =>
	name.startsWith('gbp/') ? loadGbpFixture(name.slice(4)) : loadPlacesFixture(name);

export const placeIds = loadPlacesFixture<{ target: string; competitor: string; movedFrom: string }>('ids');

/** One scripted reply: an HTTP status plus a fixture name (or inline body), or a network failure. */
export type FakeStep =
	| { status: number; fixture: string; retryAfter?: string }
	| { status: number; body: unknown; retryAfter?: string }
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
		const body = 'fixture' in step ? loadFixture(step.fixture) : step.body;
		if (step.status >= 400) throw httpErrorFromResponse(step.status, body, step.retryAfter);
		return { status: step.status, data: body as T };
	};
	return { transport, requests, remaining: () => queue.length };
};
