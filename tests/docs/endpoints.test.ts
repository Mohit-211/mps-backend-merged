import fs from 'fs';
import path from 'path';
import express from 'express';
import { ENDPOINT_STATUSES, DocEntry, RouteEntry, listRoutes, parseEndpointsDoc, routeKey } from '../helpers/endpoints';

// `npm run check:endpoints` (also part of `npm test`): docs/ENDPOINTS.md must list exactly the routes
// the app registers. The app is loaded without MongoDB, agenda or the heartbeat cron.

jest.mock('../../src/configs/mongoConnection', () => ({ agenda: {} }));
jest.mock('node-cron', () => ({ schedule: jest.fn() }));

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const app: express.Express = require('../../src/app').default;
const devConnectRoutes: express.Router = require('../../src/routes/dev/devConnect.route').default;
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

const DOC_PATH = path.resolve(__dirname, '../../docs/ENDPOINTS.md');
const doc = parseEndpointsDoc(fs.readFileSync(DOC_PATH, 'utf8'));

const devApp = express();
devApp.use('/dev', devConnectRoutes);
const devRoutes = listRoutes(devApp);
const appRoutes = listRoutes(app);

const fmt = (r: RouteEntry & { line?: number }) => `  ${r.method} ${r.path}${r.line ? ` (ENDPOINTS.md:${r.line})` : ''}`;
const missing = (from: RouteEntry[], inList: RouteEntry[]) => {
	const keys = new Set(inList.map(routeKey));
	return from.filter((r) => !keys.has(routeKey(r)));
};
const report = (title: string, rows: RouteEntry[]) => (rows.length ? `${title}:\n${rows.map(fmt).join('\n')}` : '');

describe('docs/ENDPOINTS.md matches the registered routes', () => {
	const devOnly = doc.catalogue.filter((e) => e.status === 'dev only');
	const everywhere = doc.catalogue.filter((e) => e.status !== 'dev only');

	it('parses a non-empty catalogue with valid statuses and no duplicates', () => {
		expect(doc.catalogue.length).toBeGreaterThan(100);
		const bad = doc.catalogue.filter((e) => !(ENDPOINT_STATUSES as readonly string[]).includes(e.status) || !e.auth || !e.purpose || !e.phase);
		expect(bad.map((e: DocEntry) => `${fmt(e)}: status "${e.status}"`)).toEqual([]);
		const seen = new Map<string, number>();
		const dupes = doc.catalogue.filter((e) => {
			const k = routeKey(e);
			const first = seen.get(k);
			seen.set(k, first ?? e.line);
			return first !== undefined;
		});
		expect(dupes.map((e) => fmt(e))).toEqual([]);
	});

	it('every registered route is documented, and every documented route exists', () => {
		const problems = [
			report('Registered but missing from docs/ENDPOINTS.md (add a catalogue row)', missing(appRoutes, everywhere)),
			report('In docs/ENDPOINTS.md but not registered (remove the row, or mark it "dev only")', missing(everywhere, appRoutes)),
		].filter(Boolean);
		expect(problems.join('\n\n')).toBe('');
	});

	it('dev-only routes match the dev router and are not registered outside development', () => {
		const problems = [
			report('Dev routes missing from docs/ENDPOINTS.md (status "dev only")', missing(devRoutes, devOnly)),
			report('"dev only" rows with no dev route', missing(devOnly, devRoutes)),
			report('Dev routes registered outside development', appRoutes.filter((r) => r.path.startsWith('/dev/') || r.path === '/dev')),
		].filter(Boolean);
		expect(problems.join('\n\n')).toBe('');
	});

	it('every detail-table row (#) is in the catalogue', () => {
		expect(report('Detail rows not in the catalogue', missing(doc.details, doc.catalogue))).toBe('');
		expect(doc.details.length).toBeGreaterThan(20);
	});
});

describe('listRoutes', () => {
	it('expands nested routers with params, and counts a path-mounted middleware as GET', () => {
		const inner = express.Router();
		inner.get('/', (_q, s) => s.end());
		inner.put('/:id/x', (_q, s) => s.end());
		const outer = express.Router();
		outer.use('/items', inner);
		const a = express();
		a.use('/api', (_q, _s, n) => n(), outer); // middleware in front of a router: not an endpoint
		a.use('/static-ui', (_q, s) => s.end());
		a.post('/ping', (_q, s) => s.end());
		expect(listRoutes(a)).toEqual([
			{ method: 'GET', path: '/api/items' },
			{ method: 'PUT', path: '/api/items/:id/x' },
			{ method: 'POST', path: '/ping' },
			{ method: 'GET', path: '/static-ui' },
		]);
	});
});

describe('parseEndpointsDoc', () => {
	it('keeps escaped pipes inside a cell and reads detail rows relative to /api/v1', () => {
		const doc = parseEndpointsDoc(
			[
				'| Method | Path | Auth | Purpose | Phase | Status |',
				'|---|---|---|---|---|---|',
				'| GET | `/api/v1/x` | user | Range `28d\\|90d` | 7c | live |',
				'',
				'| # | Method | Path | Returns |',
				'|---|---|---|---|',
				'| 1 | GET | `/x` | `a \\| b` |',
			].join('\n'),
		);
		expect(doc.catalogue).toEqual([{ method: 'GET', path: '/api/v1/x', auth: 'user', purpose: 'Range 28d|90d', phase: '7c', status: 'live', line: 3 }]);
		expect(doc.details).toEqual([{ method: 'GET', path: '/api/v1/x', line: 7 }]);
	});
});
