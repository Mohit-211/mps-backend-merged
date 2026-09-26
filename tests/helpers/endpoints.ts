import type { Express, Router } from 'express';

// Endpoint-doc check (standing rule, Mohit 2026-09-26): docs/ENDPOINTS.md must list exactly the
// routes the Express app registers. These helpers enumerate the app's routes and parse the doc.

export interface RouteEntry {
	method: string;
	path: string;
}

export const ENDPOINT_STATUSES = ['live', 'behind flag', 'deprecated', 'dev only'] as const;
export type EndpointStatus = (typeof ENDPOINT_STATUSES)[number];

export interface DocEntry extends RouteEntry {
	auth: string;
	purpose: string;
	phase: string;
	status: string;
	line: number;
}

interface Layer {
	route?: { path: string | string[]; methods: Record<string, boolean> };
	name: string;
	handle: { stack?: Layer[] };
	regexp: RegExp & { fast_slash?: boolean };
	keys: { name: string }[];
}

/** Turns an Express 4 mount regexp (router.use('/a/:id', …)) back into its path. */
const mountPath = (layer: Layer): string => {
	if (layer.regexp.fast_slash) return '';
	let keyIndex = 0;
	const path = layer.regexp.source
		.replace(/^\^/, '')
		.replace(/\\\/\?\(\?=\\\/\|\$\)$/, '') // trailing "\/?(?=\/|$)"
		.replace(/\(\?:\(\[\^\\\/\]\+\?\)\)/g, () => `:${layer.keys[keyIndex++]?.name ?? 'param'}`)
		.replace(/\\\//g, '/')
		.replace(/\\\./g, '.')
		.replace(/\\-/g, '-');
	if (/[()[\]^$*+?|\\]/.test(path)) throw new Error(`Unsupported mount path pattern: ${layer.regexp.source}`);
	return path;
};

const joinPath = (prefix: string, path: string): string => {
	const joined = `${prefix}/${path}`.replace(/\/+/g, '/');
	return joined.length > 1 ? joined.replace(/\/$/, '') : joined;
};

interface Walk {
	routes: RouteEntry[];
	routerMounts: Set<string>;
	middlewareMounts: Set<string>;
}

const walk = (stack: Layer[], prefix: string, out: Walk): void => {
	for (const layer of stack) {
		if (layer.route) {
			const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
			for (const p of paths) {
				for (const method of Object.keys(layer.route.methods)) {
					if (method === '_all') continue;
					out.routes.push({ method: method.toUpperCase(), path: joinPath(prefix, p) });
				}
			}
		} else if (layer.name === 'router' && layer.handle.stack) {
			const at = joinPath(prefix, mountPath(layer));
			out.routerMounts.add(at);
			walk(layer.handle.stack, at, out);
		} else if (!layer.regexp.fast_slash) {
			// A middleware mounted on a path (app.use('/docs', swaggerUi…)) serves pages there.
			out.middlewareMounts.add(joinPath(prefix, mountPath(layer)));
		}
	}
};

/**
 * Every method + path registered on the app (routers expanded, duplicates removed, sorted). A
 * middleware mounted on its own path (e.g. swagger at /docs) counts as `GET <path>`; middleware
 * mounted in front of a router (multer on /api/v1) doesn't.
 */
export const listRoutes = (app: Express | Router, prefix = ''): RouteEntry[] => {
	const stack = ((app as Express)._router?.stack ?? (app as Router).stack) as Layer[];
	const out: Walk = { routes: [], routerMounts: new Set(), middlewareMounts: new Set() };
	walk(stack, prefix, out);
	for (const path of out.middlewareMounts) {
		if (!out.routerMounts.has(path)) out.routes.push({ method: 'GET', path });
	}
	const seen = new Set<string>();
	return out.routes
		.filter((r) => {
			const k = routeKey(r);
			if (seen.has(k)) return false;
			seen.add(k);
			return true;
		})
		.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
};

/** Path params are compared by position, not name (":id" and ":locationId" are the same route). */
export const routeKey = (r: RouteEntry): string => `${r.method} ${r.path.replace(/:[A-Za-z0-9_]+/g, ':')}`;

const CATALOGUE_HEADER = ['method', 'path', 'auth', 'purpose', 'phase', 'status'];

const cells = (line: string): string[] =>
	line
		.trim()
		.replace(/^\|/, '')
		.replace(/\|$/, '')
		.split('|')
		.map((c) => c.trim());

const unticked = (s: string): string => s.replace(/`/g, '').trim();

/**
 * Parses docs/ENDPOINTS.md. Catalogue tables have exactly the header
 * `| Method | Path | Auth | Purpose | Phase | Status |` with full paths (`/api/v1/...`). Detail tables
 * (`| # | Method | Path | …`) use paths relative to `/api/v1` and are returned separately.
 */
export const parseEndpointsDoc = (markdown: string): { catalogue: DocEntry[]; details: (RouteEntry & { line: number })[] } => {
	const lines = markdown.split('\n');
	const catalogue: DocEntry[] = [];
	const details: (RouteEntry & { line: number })[] = [];
	let mode: 'none' | 'catalogue' | 'detail' | 'other' = 'none';
	lines.forEach((line, i) => {
		if (!line.trim().startsWith('|')) {
			mode = 'none';
			return;
		}
		const row = cells(line);
		const lower = row.map((c) => c.toLowerCase());
		if (mode === 'none') {
			if (row.length === CATALOGUE_HEADER.length && CATALOGUE_HEADER.every((h, j) => lower[j] === h)) mode = 'catalogue';
			else if (lower[0] === '#' && lower[1] === 'method' && lower[2] === 'path') mode = 'detail';
			else mode = 'other';
			return;
		}
		if (mode === 'other' || /^:?-+:?$/.test(row[0])) return; // unrelated table, or the separator row
		if (mode === 'catalogue') {
			const [method, path, auth, purpose, phase, status] = row.map(unticked);
			catalogue.push({ method: method.toUpperCase(), path, auth, purpose, phase, status, line: i + 1 });
		} else {
			details.push({ method: unticked(row[1]).toUpperCase(), path: joinPath('/api/v1', unticked(row[2])), line: i + 1 });
		}
	});
	return { catalogue, details };
};
