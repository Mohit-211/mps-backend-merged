import express from 'express';
import request from 'supertest';
import { Types } from 'mongoose';
import { queryTypesArr } from '../../src/configs/constantTypes';
import logger from '../../src/configs/logger';
import { ApiUsage, AuthLink, Client, GbpReport, Location, Membership, Organization, RankRun, User, UserGBP } from '../../src/models';
import { activateBilling } from '../helpers/billing';
import { hashLinkToken } from '../../src/services/auth/links';
import { apiErrorHandler, getQueryParams } from '../../src/utils';
import { loadPlacesFixture } from '../helpers/fakeTransport';
import { addMember, clearDb, createLocation, createUser, ensureOrg, keywordsOf, startTestDb } from '../helpers/mongoose';

// Phase 8 over HTTP: auth, organization, locations, clients, roles and limits (offline).

jest.mock('../../src/configs/mongoConnection', () => ({ agenda: {} }));
const scheduleMock = jest.fn(async () => ({}));
const cancelMock = jest.fn(async () => 0);
jest.mock('../../src/configs/agenda', () => ({ getAgenda: () => ({ schedule: scheduleMock, cancel: cancelMock }), stopAgenda: jest.fn() }));

const sentCodes: { to: string; code: string; kind: string }[] = [];
jest.mock('../../src/services/common/email.service', () => ({
	...jest.requireActual('../../src/services/common/email.service'),
	// Phase 8.1: verification is a link; `code` holds the link's token.
	sendVerificationLinkEmail: jest.fn(async (to: string, link: string) => sentCodes.push({ to, code: new URL(link).searchParams.get('token') ?? '', kind: 'verify' }) > 0),
	sendPasswordResetLinkEmail: jest.fn(async (to: string, link: string) => sentCodes.push({ to, code: new URL(link).searchParams.get('token') ?? '', kind: 'reset' }) > 0),
}));

const detailsCalls: string[] = [];
jest.mock('../../src/clients/placesClient', () => {
	const actual = jest.requireActual('../../src/clients/placesClient');
	return {
		...actual,
		placesClient: {
			getPlaceDetails: async (placeId: string) => {
				detailsCalls.push(placeId);
				// oxlint-disable-next-line typescript/no-var-requires
				const raw = require('../helpers/fakeTransport').loadPlacesFixture('placeDetails_add_location');
				const details = {
					id: placeId,
					displayName: raw.displayName.text,
					formattedAddress: raw.formattedAddress,
					location: raw.location,
					nationalPhoneNumber: raw.nationalPhoneNumber,
					websiteUri: raw.websiteUri,
					primaryTypeDisplayName: raw.primaryTypeDisplayName.text,
					addressComponents: raw.addressComponents.map((c: { longText: string; shortText: string; types: string[] }) => ({ long: c.longText, short: c.shortText, types: c.types })),
				};
				return { details, apiCalls: 1 };
			},
			searchTextNamesAddresses: async () => ({ places: [], apiCalls: 1 }),
		},
	};
});

/* oxlint-disable typescript/no-var-requires */
const routes: [string, express.Router][] = [
	['/api/v1/auth', require('../../src/routes/v1/common/auth.route').default],
	['/api/v1/organization', require('../../src/routes/v1/common/organization.route').default],
	['/api/v1/clients', require('../../src/routes/v1/common/clients.route').default],
	['/api/v1/locations', require('../../src/routes/v1/common/location.route').default],
	['/api/v1/locations', require('../../src/routes/v1/common/ranking.route').default],
	['/api/v1/onboarding', require('../../src/routes/v1/common/onboarding.route').default],
];
/* oxlint-enable typescript/no-var-requires */

const app = express();
app.use(express.json());
app.use(getQueryParams(queryTypesArr));
for (const [path, router] of routes) app.use(path, router);
app.use(apiErrorHandler);

const auth = (token: string, orgId?: string) => ({ Authorization: `Bearer ${token}`, ...(orgId ? { 'X-Organization-Id': orgId } : {}) });

let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
	await Promise.all([AuthLink.syncIndexes(), Organization.syncIndexes(), UserGBP.syncIndexes(), GbpReport.syncIndexes()]);
}, 60000);
afterAll(async () => db.stop());
beforeEach(async () => {
	await clearDb();
	sentCodes.length = 0;
	detailsCalls.length = 0;
	scheduleMock.mockClear();
});

const signupBody = (over: Record<string, unknown> = {}) => ({
	account_type: 'agency',
	name: 'Pat Owner',
	email: 'Pat@Agency.test',
	password: 'secret123',
	organization_name: 'Pat Agency',
	country: 'US',
	accept_terms: true,
	...over,
});

describe('auth', () => {
	it('signup → verify (link) → login; link tokens are stored hashed; logs carry no email, token or password', async () => {
		const info = jest.spyOn(logger, 'info');
		const res = await request(app).post('/api/v1/auth/signup').send(signupBody());
		expect(res.status).toBe(201);
		expect(res.body.data).toMatchObject({ email_verification: 'sent' });
		const user = await User.findOne({ email: 'pat@agency.test' }).lean();
		expect(user).toMatchObject({ user_type: 'AGENCY', status: 'PENDING' });
		const org = await Organization.findById(res.body.data.organization_id).lean();
		expect(org).toMatchObject({ name: 'Pat Agency', type: 'agency', country: 'US' });
		expect(await Membership.countDocuments({ organization_id: org?._id, user_id: user?._id, role: 'owner' })).toBe(1);

		const { code } = sentCodes[0];
		const stored = await AuthLink.findOne({ subject_kind: 'user', subject_id: user?._id }).lean();
		expect(stored?.token_hash).toBe(hashLinkToken(code));
		expect(JSON.stringify(stored)).not.toContain(`"${code}"`);

		const unverified = await request(app).post('/api/v1/auth/login').send({ email: 'pat@agency.test', password: 'secret123' });
		expect(unverified.status).toBe(403);
		expect(unverified.body.data).toEqual({ reason: 'email_not_verified', resend: '/api/v1/auth/resend-verification' });

		const verified = await request(app).post('/api/v1/auth/verify-email').send({ token: code });
		expect(verified.status).toBe(200);
		expect(verified.body.data).toMatchObject({
			verified: true,
			user: { email: 'pat@agency.test', user_type: 'AGENCY' },
			organizations: [{ name: 'Pat Agency', type: 'agency', role: 'owner' }],
			onboarding: { type: 'agency', next_step: 'google' },
		});
		expect(verified.body.data.tokens.access.token).toEqual(expect.any(String));

		const login = await request(app).post('/api/v1/auth/login').send({ email: 'PAT@agency.test', password: 'secret123' });
		expect(login.status).toBe(200);
		expect(login.body.data.current_organization_id).toBe(String(org?._id));

		const logged = info.mock.calls.map((c) => String(c[0])).join('\n');
		expect(logged).not.toMatch(/pat@agency\.test/i);
		expect(logged).not.toContain(code);
		expect(logged).not.toContain('secret123');
		info.mockRestore();
	});

	it('validation, duplicate email (409), wrong credentials (401, same message for an unknown email)', async () => {
		expect((await request(app).post('/api/v1/auth/signup').send(signupBody({ password: 'short' }))).status).toBe(400);
		expect((await request(app).post('/api/v1/auth/signup').send(signupBody({ accept_terms: false }))).status).toBe(400);
		expect((await request(app).post('/api/v1/auth/signup').send(signupBody({ country: 'GB' }))).status).toBe(400);
		expect((await request(app).post('/api/v1/auth/signup').send(signupBody())).status).toBe(201);
		const dup = await request(app).post('/api/v1/auth/signup').send(signupBody({ email: 'pat@agency.test' }));
		expect(dup.status).toBe(409);
		await User.updateOne({ email: 'pat@agency.test' }, { $set: { status: 'ACCEPTED', email_verified_at: new Date() } });
		const wrong = await request(app).post('/api/v1/auth/login').send({ email: 'pat@agency.test', password: 'nope12345' });
		const unknown = await request(app).post('/api/v1/auth/login').send({ email: 'ghost@agency.test', password: 'nope12345' });
		expect([wrong.status, unknown.status]).toEqual([401, 401]);
		expect(wrong.body.message).toBe(unknown.body.message);
	});

	// Link expiry, reuse, resend and cleanup: tests/routes/emailVerification.routes.test.ts (Phase 8.1).

	it('resend and forgot answer the same for unknown accounts; reset by link changes the password and signs out', async () => {
		const unknownResend = await request(app).post('/api/v1/auth/resend-verification').send({ email: 'ghost@x.test' });
		const unknownForgot = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'ghost@x.test' });
		expect([unknownResend.status, unknownForgot.status]).toEqual([200, 200]);
		expect(sentCodes).toHaveLength(0);

		await request(app).post('/api/v1/auth/signup').send(signupBody());
		sentCodes.length = 0;
		await User.updateOne({ email: 'pat@agency.test' }, { $set: { status: 'ACCEPTED', email_verified_at: new Date() } });
		const forgot = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'pat@agency.test' });
		expect(forgot.body.message).toBe(unknownForgot.body.message);
		const session = await request(app).post('/api/v1/auth/login').send({ email: 'pat@agency.test', password: 'secret123' });
		const first = sentCodes.filter((c) => c.kind === 'reset')[0].code;
		const reset = (token: string, password = 'newpass456', confirm = password) =>
			request(app).post('/api/v1/auth/reset-password').send({ token, password, confirm_password: confirm });
		// A newer link replaces the older one; mismatched or weak passwords are refused; a bad token is link_invalid.
		await request(app).post('/api/v1/auth/forgot-password').send({ email: 'pat@agency.test' });
		const second = sentCodes.filter((c) => c.kind === 'reset')[1].code;
		expect((await reset(first)).body.data).toMatchObject({ reason: 'link_invalid' });
		expect((await reset(second, 'newpass456', 'newpass457')).body.data).toMatchObject({ reason: 'passwords_do_not_match' });
		expect((await reset(second, 'short', 'short')).status).toBe(400);
		expect((await reset('garbage')).body.data).toMatchObject({ reason: 'link_invalid' });
		const link = await AuthLink.findOne({ subject_kind: 'user', purpose: 'reset_password' }).lean();
		expect(link?.expires_at.getTime()).toBeLessThanOrEqual(Date.now() + 60 * 60_000);
		expect((await reset(second)).status).toBe(200);
		expect((await reset(second)).body.data).toMatchObject({ reason: 'link_invalid' }); // single use
		expect((await request(app).post('/api/v1/auth/refresh').send({ refresh_token: session.body.data.tokens.refresh.token })).status).toBe(401);
		expect((await request(app).post('/api/v1/auth/login').send({ email: 'pat@agency.test', password: 'secret123' })).status).toBe(401);
		expect((await request(app).post('/api/v1/auth/login').send({ email: 'pat@agency.test', password: 'newpass456' })).status).toBe(200);
	});

	it('reset: an expired link answers link_expired; the link proves the mailbox, so an unverified account becomes verified', async () => {
		await request(app).post('/api/v1/auth/signup').send(signupBody());
		await request(app).post('/api/v1/auth/forgot-password').send({ email: 'pat@agency.test' });
		const token = sentCodes.filter((c) => c.kind === 'reset')[0].code;
		await AuthLink.updateOne({ purpose: 'reset_password' }, { $set: { expires_at: new Date(Date.now() - 1000) } });
		expect((await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'newpass456', confirm_password: 'newpass456' })).body.data).toMatchObject({ reason: 'link_expired' });
		await request(app).post('/api/v1/auth/forgot-password').send({ email: 'pat@agency.test' });
		const fresh = sentCodes.filter((c) => c.kind === 'reset')[1].code;
		expect((await request(app).post('/api/v1/auth/reset-password').send({ token: fresh, password: 'newpass456', confirm_password: 'newpass456' })).status).toBe(200);
		expect((await User.findOne({ email: 'pat@agency.test' }).lean())?.email_verified_at).toBeInstanceOf(Date);
	});

	it('rate limits: login 10 per 15 minutes per email + IP (429 with retry_after_seconds)', async () => {
		for (let i = 0; i < 10; i += 1) await request(app).post('/api/v1/auth/login').send({ email: 'ghost@x.test', password: 'whatever1' });
		const limited = await request(app).post('/api/v1/auth/login').send({ email: 'ghost@x.test', password: 'whatever1' });
		expect(limited.status).toBe(429);
		expect(limited.body.data).toMatchObject({ reason: 'rate_limited', retry_after_seconds: expect.any(Number) });
		// Another email is counted separately.
		expect((await request(app).post('/api/v1/auth/login').send({ email: 'other@x.test', password: 'whatever1' })).status).toBe(401);
	});
});

/** An owner with an organization of the given type; returns token and ids. */
const orgOwner = async (email: string, type: 'business' | 'agency' = 'agency') => {
	const { user, token } = await createUser(email);
	const org = await ensureOrg(user._id, type);
	return { user, token, orgId: String(org._id), org };
};

describe('organization and usage', () => {
	it('GET /organization, usage with the default limit, and a plan limit from the subscription plan', async () => {
		const { user, token, orgId } = await orgOwner('o@test.dev');
		await createLocation(user._id as Types.ObjectId, { tracking: { keywords: keywordsOf('plumber', 'drain') } });
		const org = await request(app).get('/api/v1/organization').set(auth(token));
		expect(org.body.data).toMatchObject({ organization: { id: orgId, type: 'agency' }, role: 'owner', memberships: [{ organization_id: orgId, role: 'owner' }] });
		const usage = await request(app).get('/api/v1/organization/usage').set(auth(token));
		// Phase 13a: the plan, the billing state, locations and users against the entitlement.
		expect(usage.body.data).toMatchObject({
			plan: { name: 'Standard', kind: 'standard' },
			billing: { state: 'trialing', read_only: false },
			locations: { used: 1, limit: 1, max: 20 },
			users: { used: 1, limit: 3 },
			tokens: { balance: 100 },
			keywords: { used: 2, limit: null },
			clients: { used: 0 },
		});
		// Phase 12.5: the organization's Google API usage (ledger counts; list-price estimate).
		expect(usage.body.data.api_usage).toMatchObject({ by_sku: {}, estimated_cost_usd: 0, previous_month: { by_sku: {} } });
		const month = new Date().toISOString().slice(0, 7);
		await ApiUsage.create([
			{ organization_id: orgId, location_id: null, month, sku: 'places.text.pro', count: 50 },
			{ organization_id: orgId, location_id: null, month, sku: 'places.text.ids_only', count: 870 },
			{ organization_id: new Types.ObjectId(), location_id: null, month, sku: 'places.text.pro', count: 999 },
		]);
		const withUsage = (await request(app).get('/api/v1/organization/usage').set(auth(token))).body.data.api_usage;
		expect(withUsage).toMatchObject({ month, by_sku: { 'places.text.ids_only': 870, 'places.text.pro': 50 }, estimated_cost_usd: 1.6 });
		await activateBilling(orgId, { quantity: 5 });
		const withPlan = (await request(app).get('/api/v1/organization/usage').set(auth(token))).body.data;
		expect(withPlan).toMatchObject({ billing: { state: 'active' }, locations: { limit: 5 }, users: { limit: 15 }, keywords: { used: 2, limit: null } });
	});

	it('PATCH is owner-only; a user without an organization gets 403 no_organization; a foreign X-Organization-Id is refused', async () => {
		const { token, org } = await orgOwner('o@test.dev');
		const { user: m, token: memberToken } = await createUser('m@test.dev');
		await addMember(org._id, m._id, 'member');
		expect((await request(app).patch('/api/v1/organization').set(auth(memberToken)).send({ name: 'X' })).status).toBe(403);
		expect((await request(app).patch('/api/v1/organization').set(auth(token)).send({ name: 'Renamed' })).body.data.organization.name).toBe('Renamed');
		const { token: lonely } = await createUser('lonely@test.dev');
		const none = await request(app).get('/api/v1/organization').set(auth(lonely));
		expect([none.status, none.body.data]).toEqual([403, { reason: 'no_organization' }]);
		const other = await orgOwner('x@test.dev');
		const foreign = await request(app).get('/api/v1/organization').set(auth(token, other.orgId));
		expect([foreign.status, foreign.body.data]).toEqual([403, { reason: 'not_a_member' }]);
		const members = await request(app).get('/api/v1/organization/members').set(auth(token));
		expect(members.body.data.map((x: { role: string }) => x.role)).toEqual(['owner', 'member']);
	});
});

describe('locations', () => {
	it('POST /locations adds from a Places result (1 Details call); duplicates 409; trial and paid-slot limits (402); delete frees the slot', async () => {
		const { token, orgId } = await orgOwner('o@test.dev', 'business');
		const added = await request(app).post('/api/v1/locations').set(auth(token)).send({ place_id: 'ChIJaddedPlace0000000001' });
		expect(added.status).toBe(201);
		expect(added.body.data.location).toMatchObject({ name: 'Fredericton Plumbing Co', city: 'Fredericton', state: 'NB', country: 'Canada', source: 'places_search', gbp_connected: false, status: 'setup_required', onboarding: { step: 'place_selected' } });
		expect(detailsCalls).toEqual(['ChIJaddedPlace0000000001']);

		const dup = await request(app).post('/api/v1/locations').set(auth(token)).send({ place_id: 'ChIJaddedPlace0000000001' });
		expect([dup.status, dup.body.data.reason]).toEqual([409, 'duplicate_place']);
		// Phase 13a: the trial includes 1 location; with a subscription for 1, the second needs a paid slot.
		const trial = await request(app).post('/api/v1/locations').set(auth(token)).send({ place_id: 'ChIJsecondPlace000000001' });
		expect([trial.status, trial.body.data]).toEqual([402, { reason: 'subscription_required', billing: expect.objectContaining({ state: 'trialing' }) }]);
		await activateBilling(orgId, { quantity: 1 });
		const slot = await request(app).post('/api/v1/locations').set(auth(token)).send({ place_id: 'ChIJsecondPlace000000001' });
		expect(slot.status).toBe(402);
		expect(slot.body.data).toMatchObject({ reason: 'location_payment_required', used: 1, paid: 1, quote: { quantity: 1, currency: 'CAD', new_paid_quantity: 2, amount: expect.any(Number) } });
		expect(detailsCalls).toHaveLength(1);

		const id = added.body.data.location.location_id;
		const del = await request(app).delete(`/api/v1/locations/${id}`).set(auth(token));
		expect(del.body.data).toMatchObject({ deleted: true, usage: { used: 0, limit: 1 } });
		expect(await RankRun.countDocuments()).toBe(0);
		expect((await request(app).get(`/api/v1/locations/${id}`).set(auth(token))).status).toBe(404);
		// The place can be added again (history of the deleted one is kept).
		expect((await request(app).post('/api/v1/locations').set(auth(token)).send({ place_id: 'ChIJaddedPlace0000000001' })).status).toBe(201);
		expect(await Location.countDocuments({ place_id: 'ChIJaddedPlace0000000001' }).setOptions({})).toBe(1);
	});

	it('GET /locations: rows with status, rank and GBP summaries; search, filter, sort and paging', async () => {
		const { user, token, org } = await orgOwner('o@test.dev');
		const uid = user._id as Types.ObjectId;
		const done = { keywords: keywordsOf('plumber') };
		const a = await createLocation(uid, { name: 'Alpha Plumbing', place_id: 'ChIJalpha0000000000000001', tracking: done });
		const b = await createLocation(uid, { name: 'Beta Drains', place_id: 'ChIJbeta00000000000000001', tracking: done });
		await createLocation(uid, { name: 'Gamma Setup', place_id: 'ChIJgamma0000000000000001', tracking: { keywords: [] } });
		await UserGBP.create({ user_id: uid, location_id: b._id, gbpAccountId: 'accounts/1', gbpLocationId: 'locations/1', google_sub: 's' });
		await Location.updateOne({ _id: a._id }, { $set: { summary: { overall_avg_rank: 4.2, overall_change: 1.1, last_run_at: new Date(), gbp_score: 71, gbp_grade: 'B', gbp_partial: true, rating: 4.6, review_count: 88 } } });
		await Location.updateOne({ _id: b._id }, { $set: { summary: { overall_avg_rank: 9.5, overall_change: null, last_run_at: new Date(), gbp_score: null, gbp_grade: null, gbp_partial: null, rating: null, review_count: null } } });

		const list = (await request(app).get('/api/v1/locations?sort=rank').set(auth(token))).body.data;
		expect(list.total).toBe(3);
		expect(list.locations.map((l: { name: string; status: string }) => [l.name, l.status])).toEqual([
			['Gamma Setup', 'setup_required'],
			['Alpha Plumbing', 'gbp_not_connected'],
			['Beta Drains', 'reconnect_required'], // bound, but no active Google connection
		]);
		expect(list.locations[1]).toMatchObject({ rank: { overall_avg_rank: 4.2, change: 1.1 }, gbp: { score: 71, grade: 'B', partial: true }, reviews: { rating: 4.6, count: 88 } });
		expect((await request(app).get('/api/v1/locations?search=drain').set(auth(token))).body.data.locations.map((l: { name: string }) => l.name)).toEqual(['Beta Drains']);
		expect((await request(app).get('/api/v1/locations?status=setup_required').set(auth(token))).body.data.total).toBe(1);
		const paged = (await request(app).get('/api/v1/locations?sort=name&order=desc&limit=1&page=2').set(auth(token))).body.data;
		expect(paged).toMatchObject({ page: 2, limit: 1, total: 3, locations: [{ name: 'Beta Drains' }] });
		expect((await request(app).get('/api/v1/locations?sort=nope').set(auth(token))).status).toBe(400);

		const client = await Client.create({ company_name: 'Client A', organization_id: org._id });
		await Location.updateOne({ _id: a._id }, { $set: { client_id: client._id } });
		const filtered = (await request(app).get(`/api/v1/locations?client_id=${client._id}`).set(auth(token))).body.data;
		expect(filtered.locations).toEqual([expect.objectContaining({ name: 'Alpha Plumbing', client: { client_id: String(client._id), name: 'Client A' } })]);
	});

	it('GET /locations/:id and /overview (available:false sections without data); PATCH; other organizations get 404', async () => {
		const { user, token } = await orgOwner('o@test.dev', 'business');
		const loc = await createLocation(user._id as Types.ObjectId, { tracking: { keywords: keywordsOf('plumber') } });
		const header = (await request(app).get(`/api/v1/locations/${loc._id}`).set(auth(token))).body.data;
		expect(header).toMatchObject({ location_id: String(loc._id), name: 'Maple Leaf Plumbing & Heating', status: 'gbp_not_connected', gbp_connected: false });
		const overview = (await request(app).get(`/api/v1/locations/${loc._id}/overview`).set(auth(token))).body.data;
		expect(overview).toMatchObject({
			rankings: { available: false, reason: 'no_ranking_data' },
			gbp: { available: false, reason: 'gbp_not_connected' },
			performance: { available: false, reason: 'gbp_not_connected' },
			competitors: { available: false, reason: 'no_competitors' },
			empty_states: { no_keywords: false, no_ranking_data: true, gbp_not_connected: true, no_reports: true },
		});
		expect(overview.refresh).toMatchObject({ frequency: 'auto_monthly' });

		const patched = await request(app).patch(`/api/v1/locations/${loc._id}`).set(auth(token)).send({ name: 'Maple Leaf (Downtown)', timezone: 'America/Toronto' });
		expect(patched.body.data).toMatchObject({ name: 'Maple Leaf (Downtown)', timezone: 'America/Toronto' });
		expect((await request(app).patch(`/api/v1/locations/${loc._id}`).set(auth(token)).send({ timezone: 'Mars/Base' })).status).toBe(400);
		expect((await request(app).patch(`/api/v1/locations/${loc._id}`).set(auth(token)).send({ address: 'x' })).status).toBe(400);

		const other = await orgOwner('x@test.dev');
		for (const path of ['', '/overview', '/tracking', '/rank-tracker', '/gbp/report']) {
			expect((await request(app).get(`/api/v1/locations/${loc._id}${path}`).set(auth(other.token))).status).toBe(404);
		}
	});
});

describe('clients and roles', () => {
	it('agency clients CRUD and assignment; business organizations get 403 agency_only', async () => {
		const { user, token } = await orgOwner('a@test.dev');
		const loc = await createLocation(user._id as Types.ObjectId);
		const created = await request(app).post('/api/v1/clients').set(auth(token)).send({ name: 'Client A', website: 'https://a.test', contact_email: 'Boss@A.test' });
		expect(created.status).toBe(201);
		const clientId = created.body.data.client_id;
		expect(created.body.data).toMatchObject({ name: 'Client A', website: 'https://a.test', contact_email: 'boss@a.test', locations_count: 0 });
		expect((await request(app).post(`/api/v1/clients/${clientId}/locations`).set(auth(token)).send({ location_id: String(loc._id) })).status).toBe(200);
		const detail = (await request(app).get(`/api/v1/clients/${clientId}`).set(auth(token))).body.data;
		expect(detail).toMatchObject({ client: { locations_count: 1 }, locations: [{ location_id: String(loc._id) }], summary: { locations: 1 } });
		expect((await request(app).get('/api/v1/clients?search=client').set(auth(token))).body.data).toMatchObject({ total: 1, clients: [{ name: 'Client A', locations_count: 1 }] });
		expect((await request(app).patch(`/api/v1/clients/${clientId}`).set(auth(token)).send({ name: 'Client A2', status: 'INACTIVE' })).body.data).toMatchObject({ name: 'Client A2', status: 'INACTIVE' });
		expect((await request(app).delete(`/api/v1/clients/${clientId}/locations/${loc._id}`).set(auth(token))).status).toBe(200);
		await request(app).post(`/api/v1/clients/${clientId}/locations`).set(auth(token)).send({ location_id: String(loc._id) });
		const removed = await request(app).delete(`/api/v1/clients/${clientId}`).set(auth(token));
		expect(removed.body.data).toEqual({ deleted: true, locations_unassigned: 1 });
		expect((await Location.findById(loc._id))?.client_id).toBeNull();

		const business = await orgOwner('b@test.dev', 'business');
		const refused = await request(app).get('/api/v1/clients').set(auth(business.token));
		expect([refused.status, refused.body.data]).toEqual([403, { reason: 'agency_only' }]);
		const foreign = await orgOwner('c@test.dev');
		const theirs = await createLocation(foreign.user._id as Types.ObjectId);
		const mine = await request(app).post('/api/v1/clients').set(auth(token)).send({ name: 'B' });
		expect((await request(app).post(`/api/v1/clients/${mine.body.data.client_id}/locations`).set(auth(token)).send({ location_id: String(theirs._id) })).status).toBe(404);
	});

	it('client_user: read-only, only its clients and their locations', async () => {
		const { user, token, org } = await orgOwner('a@test.dev');
		const uid = user._id as Types.ObjectId;
		const clientA = await Client.create({ company_name: 'A', organization_id: org._id });
		const clientB = await Client.create({ company_name: 'B', organization_id: org._id });
		const locA = await createLocation(uid, { name: 'A loc', place_id: 'ChIJclientA0000000000001', client_id: clientA._id as Types.ObjectId, tracking: { keywords: keywordsOf('x') } });
		const locB = await createLocation(uid, { name: 'B loc', place_id: 'ChIJclientB0000000000001', client_id: clientB._id as Types.ObjectId });
		const { user: cu, token: cuToken } = await createUser('cu@test.dev');
		await addMember(org._id, cu._id, 'client_user', [clientA._id as Types.ObjectId]);

		const list = (await request(app).get('/api/v1/locations').set(auth(cuToken))).body.data;
		expect(list.locations.map((l: { name: string }) => l.name)).toEqual(['A loc']);
		expect((await request(app).get(`/api/v1/locations/${locA._id}/tracking`).set(auth(cuToken))).status).toBe(200);
		expect((await request(app).get(`/api/v1/locations/${locB._id}`).set(auth(cuToken))).status).toBe(404);
		const write = await request(app).put(`/api/v1/locations/${locA._id}/tracking`).set(auth(cuToken)).send({ keywords: ['y'] });
		expect([write.status, write.body.data]).toEqual([403, { reason: 'read_only' }]);
		expect((await request(app).delete(`/api/v1/locations/${locA._id}`).set(auth(cuToken))).status).toBe(403);
		expect((await request(app).post('/api/v1/locations').set(auth(cuToken)).send({ place_id: 'ChIJnope00000000000000001' })).status).toBe(403);
		const clients = (await request(app).get('/api/v1/clients').set(auth(cuToken))).body.data;
		expect(clients.clients.map((c: { name: string }) => c.name)).toEqual(['A']);
		expect((await request(app).get(`/api/v1/clients/${clientB._id}`).set(auth(cuToken))).status).toBe(404);
		expect((await request(app).post('/api/v1/clients').set(auth(cuToken)).send({ name: 'C' })).status).toBe(403);
		// The owner still sees everything.
		expect((await request(app).get('/api/v1/locations').set(auth(token))).body.data.total).toBe(2);
	});

	it('a member can manage locations; no organization-wide keyword cap (Phase 13a)', async () => {
		const { user, org } = await orgOwner('a@test.dev');
		const { user: m, token: memberToken } = await createUser('m@test.dev');
		await addMember(org._id, m._id, 'member');
		await createLocation(user._id as Types.ObjectId, { place_id: 'ChIJone00000000000000001', tracking: { keywords: keywordsOf('plumber', 'drains') } });
		const second = await createLocation(user._id as Types.ObjectId, { place_id: 'ChIJtwo00000000000000001' });
		expect((await request(app).put(`/api/v1/locations/${second._id}/tracking`).set(auth(memberToken)).send({ keywords: ['heater'] })).status).toBe(200);
		const more = await request(app).put(`/api/v1/locations/${second._id}/tracking`).set(auth(memberToken)).send({ keywords: ['heater', 'boiler', 'furnace'] });
		expect(more.status).toBe(200);
	});
});

describe('onboarding state', () => {
	it('agency steps are derived and resumable; google and reporting_brand can be skipped; clients are not a step (2026-10-01)', async () => {
		const { user, token, org } = await orgOwner('a@test.dev');
		let state = (await request(app).get('/api/v1/onboarding/state').set(auth(token))).body.data;
		expect(state.organization.steps).toEqual([
			{ id: 'agency_info', status: 'done' },
			{ id: 'google', status: 'pending' },
			{ id: 'first_location', status: 'pending' },
			{ id: 'location_setup', status: 'pending' },
			{ id: 'reporting_brand', status: 'pending' },
		]);
		expect(state.empty_states).toMatchObject({ no_locations: true, google_not_connected: true });
		state = (await request(app).post('/api/v1/onboarding/skip').set(auth(token)).send({ step: 'google' })).body.data;
		expect(state.organization.next_step).toBe('first_location');
		// A location without any client completes the location steps.
		await createLocation(user._id as Types.ObjectId, { tracking: { keywords: keywordsOf('x') } });
		state = (await request(app).get('/api/v1/onboarding/state').set(auth(token))).body.data;
		expect(state.organization).toMatchObject({ completed: false, next_step: 'reporting_brand' });
		// Phase 12: saving any branding completes the step (it can also be skipped).
		await Organization.updateOne({ _id: org._id }, { $set: { branding: { agency_name: 'Acme' } } });
		state = (await request(app).get('/api/v1/onboarding/state').set(auth(token))).body.data;
		expect(state.organization.steps.at(-1)).toEqual({ id: 'reporting_brand', status: 'done' });
		expect(state.organization).toMatchObject({ completed: true, next_step: null });
		expect((await request(app).post('/api/v1/onboarding/skip').set(auth(token)).send({ step: 'first_client' })).status).toBe(400);
	});
});

describe('fixtures', () => {
	it('the add-location fixture is a Canadian business', () => {
		expect(loadPlacesFixture<{ addressComponents: { shortText: string; types: string[] }[] }>('placeDetails_add_location').addressComponents.find((c) => c.types.includes('country'))?.shortText).toBe('CA');
	});
});
