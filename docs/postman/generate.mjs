// Generates the Postman collection + local environment from docs/ENDPOINTS.md (the endpoint catalogue).
// Run: npm run postman:generate. Request bodies and query params below mirror the Joi validators in
// src/middlewares; any endpoint without an entry here is still generated (no body).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const doc = fs.readFileSync(path.join(root, 'docs/ENDPOINTS.md'), 'utf8');

// ---- parse the catalogue (same table format as tests/helpers/endpoints.ts) ----
const cells = (line) =>
	line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
const unticked = (s) => s.replace(/`/g, '').trim();
const HEADER = ['method', 'path', 'auth', 'purpose', 'phase', 'status'];

const sections = [];
let section = null;
let inCatalogue = false;
let mode = 'none';
for (const line of doc.split('\n')) {
	if (/^## /.test(line)) inCatalogue = /^## Catalogue/.test(line);
	if (!inCatalogue) continue;
	if (/^### /.test(line)) {
		section = { name: line.replace(/^### /, '').trim(), rows: [] };
		sections.push(section);
		continue;
	}
	if (!line.trim().startsWith('|')) {
		mode = 'none';
		continue;
	}
	const row = cells(line);
	if (mode === 'none') {
		mode = row.length === 6 && HEADER.every((h, i) => row[i].toLowerCase() === h) ? 'catalogue' : 'other';
		continue;
	}
	if (mode !== 'catalogue' || /^:?-+:?$/.test(row[0])) continue;
	const [method, p, auth, purpose, phase, status] = row.map(unticked);
	section.rows.push({ method: method.toUpperCase(), path: p, auth, purpose, phase, status });
}

// ---- example bodies and query params (from the validators) ----
const ID = (v) => `{{${v}}}`;
const B = {
	// Admin auth + admins
	'POST /admin/auth/login': { email: '{{adminEmail}}', password: '{{adminPassword}}' },
	'POST /admin/auth/forgot-password': { email: '{{adminEmail}}' },
	'POST /admin/auth/reset-password': { token: '{{linkToken}}', password: 'NewPassw0rd', confirm_password: 'NewPassw0rd' },
	'POST /admin/auth/change-password': { current_password: '{{adminPassword}}', new_password: 'NewPassw0rd', confirm_password: 'NewPassw0rd' },
	'POST /admin/admins': { name: 'New Admin', email: 'new.admin@example.test', role_id: 2 },
	'PATCH /admin/admins/:adminId': { name: 'Renamed Admin', role_id: 4, is_active: true },
	// Auth
	'POST /auth/signup': { account_type: 'business', name: 'Pat Owner', email: '{{userEmail}}', password: '{{userPassword}}', organization_name: 'Pat Co', country: 'US', accept_terms: true },
	'POST /auth/verify-email': { token: '{{linkToken}}' },
	'POST /auth/resend-verification': { email: '{{userEmail}}' },
	'POST /auth/login': { email: '{{userEmail}}', password: '{{userPassword}}' },
	'POST /auth/forgot-password': { email: '{{userEmail}}' },
	'POST /auth/reset-password': { token: '{{linkToken}}', password: 'NewPassw0rd', confirm_password: 'NewPassw0rd' },
	'POST /auth/refresh': { refresh_token: '{{refreshToken}}' },
	'POST /auth/logout': { refresh_token: '{{refreshToken}}' },
	'POST /auth/change-password': { current_password: '{{userPassword}}', new_password: 'NewPassw0rd' },
	'PATCH /auth/me': { name: 'Pat Owner', mobile: '+1 555 010 0000' },
	'POST /auth/deactivate': { password: '{{userPassword}}' },
	'POST /auth/invitations/inspect': { token: '{{invitationToken}}' },
	'POST /auth/invitations/accept': { token: '{{invitationToken}}', name: 'New Member', password: 'Passw0rd123' },
	// Locations, organization, team, branding
	'POST /locations': { place_id: '{{placeId}}', client_id: ID('clientId') },
	'PATCH /locations/:locationId': { name: 'Example Plumbing Co', timezone: 'America/Toronto', client_id: null },
	'PATCH /organization': { name: 'Pat Co', country: 'US' },
	'PATCH /organization/members/:userId': { role: 'client_user', client_ids: [ID('clientId')] },
	'POST /organization/invitations': { email: 'teammate@example.test', role: 'member' },
	'PUT /organization/branding': {
		agency_name: 'Pat Agency', primary_color: '#1a73e8', secondary_color: '#34a853', footer_text: 'Prepared by Pat Agency',
		contact_text: 'hello@agency.example', hide_mypageseo: true, email_sender_name: 'Pat Agency', email_reply_to: 'hello@agency.example',
	},
	'PUT /organization/branding/logo': { data: '<base64 PNG or JPEG, max 512 KB>' },
	// Reports
	'POST /reports': { location_id: ID('locationId'), type: 'rank_tracker', range: '28d' },
	'POST /reports/:reportId/email': { recipients: ['client@example.test'], message: 'Your monthly report is attached.' },
	'POST /reports/:reportId/share': { expires_in_days: 30 },
	'POST /report-schedules': { scope: 'location', location_id: ID('locationId'), type: 'full', range: '28d', recipients: ['client@example.test'] },
	'PATCH /report-schedules/:scheduleId': { status: 'paused' },
	// Clients
	'POST /clients': { name: 'Acme Dental', website: 'https://acme.example', contact_email: 'owner@acme.example' },
	'PATCH /clients/:clientId': { name: 'Acme Dental Group', status: 'ACTIVE' },
	'POST /clients/:clientId/locations': { location_id: ID('locationId') },
	// Ranking, onboarding, refresh
	'PUT /locations/:locationId/tracking': { keywords: ['plumber', 'emergency plumber'], competitors: [], grid: { size: 5, spacing_km: 1 }, frequency: 'auto_monthly' },
	'PUT /locations/:locationId/center': { query: 'Fredericton, NB' },
	'POST /locations/:locationId/refresh': { types: ['rankings', 'gbp'] },
	'POST /onboarding/select-profile': { gbpAccountId: 'accounts/{{gbpAccountId}}', gbpLocationId: 'locations/{{gbpLocationId}}', google_sub: '{{googleSub}}' },
	'POST /onboarding/complete': { location_id: ID('locationId') },
	'POST /onboarding/skip': { step: 'google' },
	// GBP
	'POST /gbp/connect/code': { code: '<code from the Google popup>', state: '<state from GET /gbp/connect/popup>' },
	'POST /gbp/disconnect': { google_sub: '{{googleSub}}' },
	'POST /gbp/bind': { location_id: ID('locationId'), gbpAccountId: 'accounts/{{gbpAccountId}}', gbpLocationId: 'locations/{{gbpLocationId}}', google_sub: '{{googleSub}}' },
	'POST /gbp/unbind': { location_id: ID('locationId') },
	'DELETE /gbp/post/remove': { post_id: '{{postId}}' },
	// Citations (admin)
	'POST /admin/citations/directories': { name: 'Yelp', url: 'https://www.yelp.com', type: 'general', countries: ['US', 'CA'], category_ids: [], authority: 90, notes: '', is_active: true },
	'PATCH /admin/citations/directories/:directoryId': { authority: 85, is_active: true },
	'POST /admin/citations/categories': { name: 'Home services', slug: 'home-services', business_category_ids: [] },
	'PATCH /admin/citations/categories/:categoryId': { name: 'Home services', is_active: true },
	'POST /admin/citations/locations/:locationId/entries': { directory_ids: [ID('directoryId')] },
	'POST /admin/citations/entries/bulk': { entry_ids: [ID('entryId')], status: 'submitted', note: 'Submitted in bulk' },
	'PATCH /admin/citations/entries/:entryId': {
		status: 'nap_wrong', listing_url: 'https://www.yelp.com/biz/example',
		nap_found: { name: 'Example Plumbing', address: '1 Main St, Fredericton NB', phone: '+1 506 555 0100', website: 'https://example.test' },
		notes: 'Old phone number', checked: true, note: 'Checked manually',
	},
	'DELETE /admin/citations/entries/:entryId': { note: 'Not relevant for this business' },
	'POST /admin/citations/entries/:entryId/restore': { note: 'Restored' },
	// Billing (customer)
	'POST /billing/checkout': { quantity: 1 },
	'POST /billing/cancel': { reason: 'Not needed any more' },
	'POST /billing/location-slots': { quantity: 1 },
	'POST /billing/tokens/checkout': { pack_id: ID('packId'), coupon_code: '' },
	'POST /billing/coupon/validate': { pack_id: ID('packId'), coupon_code: 'WELCOME10' },
	'PATCH /billing/details': { name: 'Pat Co', email: 'billing@patco.example', address_line1: '1 Main St', address_line2: '', city: 'Dallas', region: 'TX', postal_code: '75201', country: 'US' },
	'POST /subscription/paypal/webhook': { id: 'WH-EXAMPLE', event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', resource: {} },
	// Billing admin
	'PATCH /admin/billing/plans/:planId': { users_per_location: 3, max_locations: 20, trial: { days: 7, locations: 1, users: 3, tokens: 0 }, tokens_per_refresh: { rankings: 1, gbp: 1 } },
	'POST /admin/billing/plans/:planId/prices': { currency: 'USD', first_location_price: 49, additional_location_price: 29, effective_from: '2026-10-01T00:00:00.000Z' },
	'POST /admin/billing/organizations/:organizationId/custom-plan': { name: 'Enterprise – Acme', max_locations: 100, users_per_location: 5, monthly_token_grant: 50, billing_method: 'manual' },
	'PATCH /admin/billing/organizations/:organizationId/billing-method': { billing_method: 'manual' },
	'POST /admin/billing/organizations/:organizationId/manual-subscription': { quantity: 25, currency: 'USD', starts_at: '2026-10-01T00:00:00.000Z', comp_until: null, note: 'Signed contract' },
	'POST /admin/billing/organizations/:organizationId/tokens': { amount: 10, type: 'grant', note: 'Goodwill' },
	'PATCH /admin/billing/subscriptions/:subscriptionId': { paid_quantity: 3, note: 'Adjusted after call' },
	'POST /admin/billing/subscriptions/:subscriptionId/cancel': { reason: 'Customer request' },
	'POST /admin/billing/invoices/:invoiceId/payments': { note: 'Bank transfer received' },
	'POST /admin/billing/invoices/:invoiceId/void': { note: 'Issued in error' },
	'POST /admin/billing/token-packs': { name: '10 tokens', tokens: 10, prices: [{ currency: 'USD', price: 9 }, { currency: 'CAD', price: 12 }], expires_after_days: null, is_active: true, sort_order: 1 },
	'PATCH /admin/billing/token-packs/:packId': { is_active: false },
	'POST /admin/billing/coupons': { code: 'WELCOME10', discount_type: 'percent', value: 10, pack_ids: [], max_redemptions: 100, expires_at: null, is_active: true },
	'PATCH /admin/billing/coupons/:couponId': { is_active: false },
	// Admin panel + support
	'POST /admin/users/:userId/disable': { reason: 'Abuse report' },
	'POST /admin/organizations/:organizationId/suspend': { reason: 'Unpaid manual invoice' },
	'POST /admin/organizations/:organizationId/unsuspend': { note: 'Paid' },
	'PATCH /admin/organizations/:organizationId/trial': { trial_ends_at: '2026-10-15T00:00:00.000Z' },
	'PATCH /admin/organizations/:organizationId/limits': { max_locations: 30, extra_users: 2 },
	'POST /admin/support/tickets/:ticketId/messages': { message: 'Thanks, we are looking into it.', internal: false },
	'PATCH /admin/support/tickets/:ticketId': { status: 'in_progress', priority: 'high', assigned_to: null },
	'POST /support/tickets': { subject: 'Ranking looks wrong', category: 'data', message: 'The grid shows 60+ everywhere.', location_id: ID('locationId') },
	'POST /support/tickets/:ticketId/messages': { message: 'Here is a screenshot link.' },
	// Reference data + content (legacy)
	'POST /business-categories': { name: 'Plumber' },
	'PUT /business-categories/:businessCategoryId': { name: 'Plumber', is_active: true },
	'POST /faqs': { question: 'How often are rankings refreshed?', answer: 'Monthly, plus manual refreshes.' },
	'PUT /faqs/:faqId': { question: 'How often are rankings refreshed?', answer: 'Monthly.' },
	'POST /contact-us': {
		full_name: 'Sam Lee', business_name: 'Lee Bakery', email: 'sam@example.test', phone_number: '+1 555 010 0001', business_website: 'https://lee.example',
		business_location: 'Dallas, TX', company_size: '1-10', primary_interest: 'Local SEO', goals_or_challenges: 'More calls from Maps',
	},
	'PUT /contact-us/:contactId/status': { status: 'contacted' },
	'POST /blog-category': { title: 'Local SEO', is_active: true },
	'PUT /blog-category/:categoryId': { title: 'Local SEO', is_active: true },
};

// Multipart (form-data) bodies.
const FORM = {
	'POST /blog': [['name', 'Ranking on Google Maps'], ['short_description', 'A short intro'], ['content', '<p>…</p>'], ['author', 'Pat'], ['author_position', 'Editor'], ['date', '2026-09-30'], ['is_active', 'true'], ['main_image', null]],
	'PUT /blog/:blogId': [['name', 'Ranking on Google Maps'], ['content', '<p>…</p>'], ['main_image', null]],
	'POST /gbp/post/add': [['location_id', '{{locationId}}'], ['gbpAccountId', 'accounts/{{gbpAccountId}}'], ['gbpLocationId', 'locations/{{gbpLocationId}}'], ['topicType', 'STANDARD'], ['summary', 'Spring special this week'], ['callToAction[actionType]', 'LEARN_MORE'], ['callToAction[url]', 'https://example.test'], ['images', null]],
};

// Raw text bodies.
const RAW = {
	'POST /admin/citations/directories/import': {
		type: 'text/csv',
		body: 'name,url,type,countries,categories,authority,notes,is_active\nYelp,https://www.yelp.com,general,US|CA,,90,,true\n',
	},
};

// Optional query params (added disabled so they can be toggled on).
const Q = {
	'GET /locations': ['search', 'client_id', 'status=active', 'sort=name', 'order=asc', 'page=1', 'limit=20'],
	'GET /clients': ['search', 'status', 'page=1', 'limit=20'],
	'GET /dashboard': ['page=1', 'limit=20', 'sort=name', 'order=asc'],
	'GET /organization/invitations': ['status=pending'],
	'GET /reports': ['location_id={{locationId}}', 'client_id', 'type=rank_tracker', 'status', 'page=1', 'limit=20'],
	'GET /report-schedules': ['location_id={{locationId}}', 'client_id', 'status=active'],
	'GET /locations/:locationId/rank-runs': ['page=1', 'limit=20'],
	'GET /locations/:locationId/rank-tracker': ['runId'],
	'GET /locations/:locationId/grid': ['keyword', 'runId'],
	'GET /locations/:locationId/map-ranking': ['keyword', 'runId', 'point=C', 'resolveNames=false'],
	'GET /locations/:locationId/competitor-suggestions': ['refresh=false'],
	'GET /locations/:locationId/gbp/sync': ['syncId'],
	'GET /locations/:locationId/gbp/report': ['range=28d'],
	'GET /locations/:locationId/citations': ['status'],
	'GET /locations/:locationId/citations/changes': ['page=1', 'limit=20'],
	'GET /places/search': ['!q=plumber dallas', 'locationId', 'country=US'],
	'GET /pricing': ['country=US'],
	'GET /billing/location-slots/quote': ['quantity=1'],
	'GET /billing/invoices': ['page=1', 'limit=20'],
	'GET /billing/tokens/ledger': ['page=1', 'limit=20'],
	'GET /admin/admins': ['active=true'],
	'GET /admin/users': ['page=1', 'limit=20', 'q', 'status=active'],
	'GET /admin/organizations': ['page=1', 'limit=20', 'q', 'type=agency', 'state=trialing', 'plan=standard', 'trial_ending_days=7'],
	'GET /admin/support/tickets': ['page=1', 'limit=20', 'status=open', 'organization_id', 'assigned_to', 'unassigned', 'q'],
	'GET /support/tickets': ['page=1', 'limit=20', 'status=open'],
	'GET /admin/citations/directories': ['q', 'type', 'country=US', 'category_id', 'active=true', 'page=1', 'limit=20'],
	'GET /admin/citations/business-categories': ['q'],
	'POST /admin/citations/directories/import': ['dry_run=true'],
	'POST /admin/citations/locations/:locationId/suggest': ['dry_run=true'],
	'GET /admin/billing/plans': ['kind=standard', 'organization_id'],
	'GET /admin/billing/subscriptions': ['page=1', 'limit=20', 'status', 'billing_method', 'organization_id'],
	'GET /admin/billing/invoices': ['page=1', 'limit=20', 'status', 'kind', 'organization_id', 'q'],
	'GET /admin/billing/audit': ['page=1', 'limit=20', 'organization_id', 'action'],
	'GET /admin/billing/organizations/:organizationId/tokens/ledger': ['page=1', 'limit=20'],
};
// Queue routes share the citation queue filters.
const queueQ = ['organization_id', 'client_id', 'status', 'directory_id', 'type', 'page=1', 'limit=20'];

// Tests that save tokens and ids into the environment.
const SAVE = {
	'POST /auth/login': ['accessToken:data.tokens.access.token', 'refreshToken:data.tokens.refresh.token', 'organizationId:data.current_organization_id'],
	'POST /auth/verify-email': ['accessToken:data.tokens.access.token', 'refreshToken:data.tokens.refresh.token', 'organizationId:data.current_organization_id'],
	'POST /auth/refresh': ['accessToken:data.tokens.access.token', 'refreshToken:data.tokens.refresh.token'],
	'POST /auth/change-password': ['accessToken:data.tokens.access.token', 'refreshToken:data.tokens.refresh.token'],
	'POST /auth/invitations/accept': ['accessToken:data.tokens.access.token', 'refreshToken:data.tokens.refresh.token'],
	'POST /admin/auth/login': ['adminToken:data.token'],
	'POST /admin/auth/change-password': ['adminToken:data.token'],
	'POST /locations': ['locationId:data.location.id', 'locationId:data.location._id', 'locationId:data._id'],
	'POST /clients': ['clientId:data.client.id', 'clientId:data.client._id', 'clientId:data._id'],
	'POST /reports': ['reportId:data.report.id', 'reportId:data.report._id', 'reportId:data._id', 'reportId:data.id'],
	'POST /support/tickets': ['ticketId:data.ticket.id', 'ticketId:data.ticket._id', 'ticketId:data._id', 'ticketId:data.id'],
};

// ---- build ----
const API = '/api/v1';
const rel = (p) => (p.startsWith(API) ? p.slice(API.length) || '/' : p);

const authFor = (auth) => {
	const a = auth.toLowerCase();
	if (a.startsWith('admin')) return 'admin';
	if (a.startsWith('user') || a === 'user') return 'user';
	return 'none';
};

const buildUrl = (fullPath, query) => {
	const isApi = fullPath.startsWith(API);
	const segs = (isApi ? rel(fullPath) : fullPath).split('/').filter(Boolean);
	const host = isApi ? '{{baseUrl}}/api/v1' : '{{baseUrl}}';
	const variable = segs.filter((s) => s.startsWith(':')).map((s) => ({ key: s.slice(1), value: `{{${s.slice(1)}}}` }));
	const qs = (query ?? []).map((q) => {
		const required = q.startsWith('!');
		const [key, value = ''] = q.replace(/^!/, '').split('=');
		return { key, value, disabled: !required };
	});
	const raw = `${host}/${segs.join('/')}${qs.filter((q) => !q.disabled).length ? '?' + qs.filter((q) => !q.disabled).map((q) => `${q.key}=${q.value}`).join('&') : ''}`;
	return { raw, host: [host], path: segs, ...(qs.length ? { query: qs } : {}), ...(variable.length ? { variable } : {}) };
};

const saveScript = (entries) => {
	const byVar = new Map();
	for (const e of entries) {
		const [v, p] = e.split(':');
		byVar.set(v, [...(byVar.get(v) ?? []), p]);
	}
	const lines = ['let body = {};', 'try { body = pm.response.json(); } catch (e) { return; }', 'const get = (o, p) => p.split(".").reduce((a, k) => (a == null ? a : a[k]), o);'];
	for (const [v, paths] of byVar) {
		lines.push(`{ const val = ${paths.map((p) => `get(body, ${JSON.stringify(p)})`).join(' ?? ')}; if (val) { pm.environment.set(${JSON.stringify(v)}, val); } }`);
	}
	return [{ listen: 'test', script: { type: 'text/javascript', exec: lines } }];
};

const folders = [];
for (const s of sections) {
	if (!s.rows.length) continue;
	const items = s.rows.map((r) => {
		const key = `${r.method} ${rel(r.path)}`;
		const kind = authFor(r.auth);
		const headers = [];
		if (r.auth.toLowerCase().includes('org')) {
			headers.push({ key: 'X-Organization-Id', value: '{{organizationId}}', description: 'Optional: the organization to act in (default: your default organization).', disabled: true });
		}
		let query = Q[key];
		if (!query && key.startsWith('GET /admin/citations/queue')) query = key.endsWith('/stale') ? [...queueQ, 'days=90'] : key.endsWith('/recent') ? [...queueQ, 'days=7'] : queueQ;
		const request = {
			method: r.method,
			header: headers,
			url: buildUrl(r.path, query),
			description: `${r.purpose}\n\n**Auth:** ${r.auth} · **Phase:** ${r.phase} · **Status:** ${r.status}`,
		};
		if (kind === 'none') request.auth = { type: 'noauth' };
		else request.auth = { type: 'bearer', bearer: [{ key: 'token', value: kind === 'admin' ? '{{adminToken}}' : '{{accessToken}}', type: 'string' }] };

		if (B[key]) {
			request.header.push({ key: 'Content-Type', value: 'application/json' });
			request.body = { mode: 'raw', raw: JSON.stringify(B[key], null, 2), options: { raw: { language: 'json' } } };
		} else if (FORM[key]) {
			request.body = { mode: 'formdata', formdata: FORM[key].map(([k, v]) => (v === null ? { key: k, type: 'file', src: [] } : { key: k, value: v, type: 'text' })) };
		} else if (RAW[key]) {
			request.header.push({ key: 'Content-Type', value: RAW[key].type });
			request.body = { mode: 'raw', raw: RAW[key].body, options: { raw: { language: 'text' } } };
		}
		const item = { name: `${r.method} ${rel(r.path)}`, request };
		if (SAVE[key]) item.event = saveScript(SAVE[key]);
		return item;
	});
	folders.push({ name: s.name, item: items });
}

const known = new Set(sections.flatMap((s) => s.rows.map((r) => `${r.method} ${rel(r.path)}`)));
const stale = [B, FORM, RAW, Q, SAVE].flatMap((m) => Object.keys(m)).filter((k) => !known.has(k));
if (stale.length) {
	console.error(`Not in docs/ENDPOINTS.md (update generate.mjs):\n  ${stale.join('\n  ')}`);
	process.exit(1);
}

const vars = new Set();
JSON.stringify(folders).replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_, v) => vars.add(v));

const collection = {
	info: {
		name: 'MyPageSEO API',
		description:
			'Generated from docs/ENDPOINTS.md by `npm run postman:generate` (do not edit by hand; regenerate after endpoint changes).\n\n' +
			'1. Import this collection and `MyPageSEO.local.postman_environment.json`, select the environment.\n' +
			'2. User endpoints: run **Auth (rebuilt app) › POST /auth/login** (saves `accessToken`, `refreshToken`, `organizationId`).\n' +
			'3. Admin endpoints: run **Admin › POST /admin/auth/login** (saves `adminToken`).\n' +
			'4. Set ids such as `locationId` in the environment (creating a location, client, report or ticket saves its id).\n\n' +
			'Every response is `{ success, status, message, data }`. Request/response details: docs/API.md.',
		schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
	},
	item: folders,
};

const defaults = {
	baseUrl: 'http://localhost:5055',
	userEmail: 'live-test@mypageseo.test',
	userPassword: '',
	adminEmail: '',
	adminPassword: '',
	accessToken: '',
	refreshToken: '',
	adminToken: '',
	placeId: 'ChIJneho2koPp0wRIbUtaCCIReA',
};
const secret = new Set(['userPassword', 'adminPassword', 'accessToken', 'refreshToken', 'adminToken', 'linkToken', 'invitationToken']);
const envVars = ['baseUrl', ...[...vars].filter((v) => v !== 'baseUrl').sort()].map((key) => ({
	key,
	value: defaults[key] ?? '',
	type: secret.has(key) ? 'secret' : 'default',
	enabled: true,
}));
const environment = { name: 'MyPageSEO local', values: envVars, _postman_variable_scope: 'environment' };

fs.writeFileSync(path.join(here, 'MyPageSEO.postman_collection.json'), JSON.stringify(collection, null, '\t') + '\n');
fs.writeFileSync(path.join(here, 'MyPageSEO.local.postman_environment.json'), JSON.stringify(environment, null, '\t') + '\n');
const total = folders.reduce((n, f) => n + f.item.length, 0);
const withBody = folders.reduce((n, f) => n + f.item.filter((i) => i.request.body).length, 0);
console.log(`${total} requests in ${folders.length} folders (${withBody} with example bodies); ${envVars.length} environment variables.`);
