import express from 'express';
import request from 'supertest';
import { Types } from 'mongoose';
import { GbpLocation, RawLocation } from '../../src/clients/types/gbp';
import config from '../../src/configs/config';
import { BillingPlan, Location, Organization, PaymentOrder, RankRun, Subscription, User } from '../../src/models';
import { createScriptedPlaces, PlacesScript } from '../../src/ranking/demo/scriptedPlaces';
import { onRankRunFinished } from '../../src/gbp/hooks';
import { standardPlan } from '../../src/services/billing/plans';
import { runReportJob } from '../../src/services/gbp/report.service';
import { executeRankRun } from '../../src/services/ranking/rankRunExecutor';
import { activateBilling } from '../helpers/billing';
import { loadGbpFixture } from '../helpers/fakeTransport';
import { clearDb, startTestDb } from '../helpers/mongoose';

// 13b (Mohit, 2026-09-29): the core Business and Agency flows end to end, exactly as the frontend calls them
// (docs/FLOWS.md is the same sequence for the frontend developer). In-memory database; Google, PayPal, email
// and agenda are mocked; rank runs and the GBP report are executed in-process where the jobs would run.

jest.mock('../../src/configs/mongoConnection', () => ({ agenda: {} }));
jest.mock('../../src/configs/agenda', () => ({ getAgenda: () => ({ schedule: jest.fn(async () => ({})), cancel: jest.fn(async () => 0) }), stopAgenda: jest.fn() }));

// Emails: keep the links the user would click.
const inbox: { kind: string; to: string; link: string }[] = [];
jest.mock('../../src/services/common/email.service', () => {
	const actual = jest.requireActual('../../src/services/common/email.service');
	const keep = (kind: string) => async (to: string, link: string) => inbox.push({ kind, to, link }) > 0;
	return {
		...actual,
		sendVerificationLinkEmail: keep('verify'),
		sendPasswordResetLinkEmail: keep('reset'),
		sendInvitationEmail: keep('invite'),
		sendReportEmail: async () => true,
		sendBillingEmail: async () => true,
	};
});

// Google: one Google account that sees one GBP profile; the id_token is accepted as-is.
jest.mock('../../src/services/gbp/idToken', () => ({
	...jest.requireActual('../../src/services/gbp/idToken'),
	verifyGoogleIdToken: async () => ({ sub: '100000000000000000009', email: 'agency.google@example.test' }),
}));
const GBP_PROFILE = (): GbpLocation => {
	// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
	const { mapLocation } = require('../../src/clients/gbpClient');
	return { ...(mapLocation(loadGbpFixture<RawLocation>('location')) as GbpLocation), name: 'locations/400000000000000000001', title: 'Dental Two', placeId: 'ChIJflowGbpDental000001' };
};
jest.mock('../../src/clients/gbpClient', () => {
	const actual = jest.requireActual('../../src/clients/gbpClient');
	return {
		...actual,
		gbpClient: {
			exchangeCode: async () => ({ accessToken: 'ya29.FAKE', refreshToken: '1//FAKE', expiryDate: new Date(Date.now() + 3600_000), scope: 'openid email', idToken: 'x.y.z' }),
			getLocation: async () => GBP_PROFILE(),
			listAccounts: async () => [{ name: 'accounts/900', accountName: 'Agency Google', type: 'PERSONAL', role: 'OWNER', verificationState: null }],
			listLocations: async () => [GBP_PROFILE()],
			revoke: async () => undefined,
		},
	};
});

// Places: add-location search and Place Details for the businesses below.
const PLACES: Record<string, { name: string; city: string; region: 'US' | 'CA'; lat: number; lng: number }> = {
	ChIJflowPlumberAustin01: { name: 'Austin Plumbing Co', city: 'Austin', region: 'US', lat: 30.27, lng: -97.74 },
	ChIJflowPlumberAustin02: { name: 'Second Austin Plumbing', city: 'Austin', region: 'US', lat: 30.3, lng: -97.7 },
	ChIJflowDentalToronto01: { name: 'Dental One', city: 'Toronto', region: 'CA', lat: 43.65, lng: -79.38 },
};
jest.mock('../../src/clients/placesClient', () => {
	const actual = jest.requireActual('../../src/clients/placesClient');
	return {
		...actual,
		placesClient: {
			searchTextNamesAddresses: async () => ({
				places: Object.entries(PLACES).map(([id, p]) => ({ id, name: p.name, address: `1 Main St, ${p.city}` })),
				apiCalls: 1,
			}),
			searchTextForSuggestions: async () => ({ places: [], apiCalls: 1 }),
			getPlaceDetails: async (placeId: string) => {
				const p = PLACES[placeId];
				return {
					apiCalls: 1,
					details: p
						? {
								id: placeId,
								displayName: p.name,
								formattedAddress: `1 Main St, ${p.city}`,
								addressComponents: [
									{ long: p.city, short: p.city, types: ['locality'] },
									{ long: p.region === 'US' ? 'Texas' : 'Ontario', short: p.region === 'US' ? 'TX' : 'ON', types: ['administrative_area_level_1'] },
									{ long: p.region === 'US' ? 'United States' : 'Canada', short: p.region, types: ['country'] },
								],
								location: { latitude: p.lat, longitude: p.lng },
								nationalPhoneNumber: '(512) 555-0100',
								websiteUri: 'https://example.test',
								primaryTypeDisplayName: 'Plumber',
							}
						: { location: { latitude: 30.27, longitude: -97.74 } },
				};
			},
		},
	};
});

// PayPal (flow 4): approve and capture succeed.
const mockPaypal = {
	configured: () => true,
	mode: 'sandbox',
	callCount: () => 0,
	createSubscription: jest.fn(async (i: { custom_id: string }) => ({ id: `I-${i.custom_id.slice(-8)}`, status: 'APPROVAL_PENDING', approve_url: 'https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=BA-1' })),
	getSubscription: jest.fn(),
	setSubscriptionPrice: jest.fn(async () => undefined),
	cancelSubscription: jest.fn(async () => undefined),
	createOrder: jest.fn(async (i: { custom_id: string }) => ({ id: `O-${i.custom_id.slice(-8)}`, status: 'PAYER_ACTION_REQUIRED', custom_id: i.custom_id, approve_url: 'https://www.sandbox.paypal.com/checkoutnow?token=O-1', capture: null })),
	getOrder: jest.fn(),
	captureOrder: jest.fn(async (id: string) => {
		const o = await PaymentOrder.findOne({ provider_order_id: id }).lean();
		return { id, status: 'COMPLETED', custom_id: String(o?._id), approve_url: null, capture: { id: `CAP-${id}`, status: 'COMPLETED', amount: o?.amount ?? 0, currency: o?.currency ?? 'USD' } };
	}),
	verifyWebhookSignature: jest.fn(async () => 'SUCCESS'),
};
jest.mock('../../src/clients/paypalClient', () => ({ ...jest.requireActual('../../src/clients/paypalClient'), paypalClient: () => mockPaypal }));

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const app: express.Express = require('../../src/app').default;
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

const api = (token?: string) => {
	const auth = (r: request.Test) => (token ? r.set('Authorization', `Bearer ${token}`) : r);
	return {
		get: (path: string) => auth(request(app).get(`/api/v1${path}`)),
		post: (path: string, body: object = {}) => auth(request(app).post(`/api/v1${path}`)).send(body),
		put: (path: string, body: object = {}) => auth(request(app).put(`/api/v1${path}`)).send(body),
		patch: (path: string, body: object = {}) => auth(request(app).patch(`/api/v1${path}`)).send(body),
		delete: (path: string) => auth(request(app).delete(`/api/v1${path}`)),
	};
};
const tokenIn = (link: string) => new URL(link).searchParams.get('token') as string;
const lastLink = (kind: string, to: string) => [...inbox].reverse().find((m) => m.kind === kind && m.to === to)?.link as string;
const PASSWORD = 'Flow-pass-123';
const noSleep = async (): Promise<void> => undefined;

/** Signup → the verification email's link → verify (signed in) → login again. Returns the access token and organization id. */
const signUp = async (accountType: 'business' | 'agency', email: string, country: 'US' | 'CA') => {
	const signup = await api().post('/auth/signup', { account_type: accountType, name: 'Pat Owner', email, password: PASSWORD, organization_name: `${accountType} co`, country, accept_terms: true });
	expect(signup.status).toBe(201);
	// Unverified: login is refused with a resend hint.
	expect((await api().post('/auth/login', { email, password: PASSWORD })).body.data).toMatchObject({ reason: 'email_not_verified' });
	const verified = await api().post('/auth/verify-email', { token: tokenIn(lastLink('verify', email)) });
	expect(verified.status).toBe(200);
	expect(verified.body.data).toMatchObject({ verified: true, already_verified: false, tokens: { access: { token: expect.any(String) } } });
	const login = await api().post('/auth/login', { email, password: PASSWORD });
	expect(login.status).toBe(200);
	return { token: login.body.data.tokens.access.token as string, orgId: login.body.data.current_organization_id as string };
};

/** Keywords → competitors → complete; then the queued rank run and the GBP report, as the jobs would. */
const finishSetup = async (token: string, locationId: string, selfRank: number) => {
	const user = api(token);
	let res = await user.put(`/locations/${locationId}/tracking`, { keywords: ['plumber', 'emergency plumber'] });
	expect(res.status).toBe(200);
	expect(res.body.data.onboarding_step).toBe('keywords_set');
	res = await user.put(`/locations/${locationId}/tracking`, { competitors: ['ChIJflowCompetitor00001'] });
	expect(res.body.data.onboarding_step).toBe('competitors_set');
	res = await user.post('/onboarding/complete', { location_id: locationId });
	expect(res.status).toBe(200);
	expect(res.body.data).toMatchObject({ completed: true, rank_run: { status: 'queued' } });
	// Before the first run the pages say "not yet".
	expect((await user.get(`/locations/${locationId}/rank-tracker`)).status).toBe(404);
	const location = await Location.findById(locationId).lean();
	const script: PlacesScript = { rank: ({ placeId }) => (placeId === location?.place_id ? selfRank : 9), candidates: [String(location?.place_id), 'ChIJflowCompetitor00001'] };
	await executeRankRun(res.body.data.rank_run.run_id, { places: createScriptedPlaces(script), engine: { sleep: noSleep } });
	await onRankRunFinished(res.body.data.rank_run.run_id); // what the rank-run job does after the run
	await runReportJob(locationId, 'rank_run', { places: createScriptedPlaces(script) });
};

let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
	await Promise.all([Location.syncIndexes(), RankRun.syncIndexes(), User.syncIndexes()]);
	config.paypal.planIds.USD = 'P-USD';
	config.paypal.planIds.CAD = 'P-CAD';
	config.paypal.webhookId = 'WH-TEST';
}, 60000);
afterAll(async () => db.stop());
beforeEach(async () => {
	await clearDb();
	inbox.length = 0;
});

describe('flow 1: Business', () => {
	it('signup → verify → login → add by Places search → keywords → competitors → complete → rankings, GBP report, overview, dashboard; no clients', async () => {
		const { token } = await signUp('business', 'owner@business.test', 'US');
		const user = api(token);

		let res = await user.get('/onboarding/state');
		expect(res.status).toBe(200);

		res = await user.get('/places/search?q=austin%20plumber&country=US');
		expect(res.status).toBe(200);
		const placeId = res.body.data.results.find((p: { name: string }) => p.name === 'Austin Plumbing Co').place_id as string;

		res = await user.post('/locations', { place_id: placeId });
		expect(res.status).toBe(201);
		const locationId = res.body.data.location.location_id as string;
		expect(res.body.data.location).toMatchObject({ name: 'Austin Plumbing Co', source: 'places_search', gbp_connected: false });
		expect((await user.post('/locations', { place_id: placeId })).body.data).toMatchObject({ reason: 'duplicate_place' });

		await finishSetup(token, locationId, 2);

		for (const page of ['rank-tracker', 'grid', 'map-ranking', 'overview']) {
			res = await user.get(`/locations/${locationId}/${page}`);
			expect([page, res.status]).toEqual([page, 200]);
		}
		expect((await user.get(`/locations/${locationId}/rank-tracker`)).body.data.overall.self.overallAvgRank).toBe(2);
		res = await user.get(`/locations/${locationId}/gbp/report`);
		expect(res.status).toBe(200);
		expect(res.body.data.gbp_connected).toBe(false);
		expect(res.body.data.performance).toMatchObject({ available: false, reason: 'gbp_not_connected' });
		expect((await user.get('/dashboard')).status).toBe(200);
		expect((await user.get('/locations')).body.data.locations).toHaveLength(1);

		// A business account has no clients.
		res = await user.post('/clients', { name: 'Someone' });
		expect(res.status).toBe(403);
		expect(res.body.data).toMatchObject({ reason: 'agency_only' });
	});
});

describe('flow 2 + 3: Agency', () => {
	/** An agency with two clients and two completed locations (one from a Places search, one from a GBP profile). */
	const agencyWithTwoLocations = async () => {
		const { token, orgId } = await signUp('agency', 'owner@agency.test', 'CA');
		await activateBilling(orgId, { quantity: 5 });
		const user = api(token);
		const a = (await user.post('/clients', { name: 'Client A' })).body.data;
		const b = (await user.post('/clients', { name: 'Client B' })).body.data;
		expect([a.client_id, b.client_id]).toEqual([expect.any(String), expect.any(String)]);

		// Location 1: Places search, assigned to client A at creation.
		let res = await user.post('/locations', { place_id: 'ChIJflowDentalToronto01', client_id: a.client_id });
		expect(res.status).toBe(201);
		const placesLoc = res.body.data.location.location_id as string;
		expect(res.body.data.location.client).toMatchObject({ client_id: a.client_id });

		// Location 2: connect Google (popup) → pick the GBP profile, assigned to client B at creation.
		res = await user.get('/gbp/connect/popup');
		expect(res.status).toBe(200);
		res = await user.post('/gbp/connect/code', { code: '4/FAKE', state: res.body.data.state });
		expect(res.body.data).toMatchObject({ connected: true });
		const googleSub = res.body.data.google_sub as string;
		// In the connect modal: the account's locations, pick one, then Bind it from the locations table.
		res = await user.get(`/gbp/connections/${googleSub}/locations`);
		expect(res.body.data.locations.map((l: { gbpLocationId: string }) => l.gbpLocationId)).toEqual(['locations/400000000000000000001']);
		res = await user.put(`/gbp/connections/${googleSub}/picks`, { gbp_location_ids: ['locations/400000000000000000001'] });
		const pickId = res.body.data.locations[0].pick_id as string;
		expect((await user.get('/locations')).body.data.pending_gbp.map((p: { pick_id: string }) => p.pick_id)).toEqual([pickId]);
		res = await user.post(`/gbp/picks/${pickId}/bind`, { client_id: b.client_id });
		expect(res.status).toBe(200);
		expect(res.body.data).toMatchObject({ created: true, center_needed: false });
		const gbpLoc = res.body.data.location.location_id as string;
		expect((await Location.findById(gbpLoc).lean())?.client_id?.toString()).toBe(b.client_id);

		await finishSetup(token, placesLoc, 3);
		await finishSetup(token, gbpLoc, 7);
		return { token, orgId, user, a, b, placesLoc, gbpLoc };
	};

	it('flow 2: two clients; locations assigned at creation; reassign; unassign; client detail shows the right locations and averages', async () => {
		const { user, a, b, placesLoc, gbpLoc } = await agencyWithTwoLocations();

		let detail = (await user.get(`/clients/${a.client_id}`)).body.data;
		expect(detail.locations.map((l: { location_id: string }) => l.location_id)).toEqual([placesLoc]);
		expect(detail.summary).toMatchObject({ locations: 1, avg_rank: 3 });
		expect((await user.get(`/clients/${b.client_id}`)).body.data.summary).toMatchObject({ locations: 1, avg_rank: 7, gbp_connected: 1 });
		expect((await user.get(`/locations?client_id=${b.client_id}`)).body.data.locations.map((l: { location_id: string }) => l.location_id)).toEqual([gbpLoc]);

		// Reassign the GBP location from B to A.
		let res = await user.patch(`/locations/${gbpLoc}`, { client_id: a.client_id });
		expect(res.status).toBe(200);
		detail = (await user.get(`/clients/${a.client_id}`)).body.data;
		expect(detail.locations).toHaveLength(2);
		expect(detail.summary).toMatchObject({ locations: 2, avg_rank: 5 });
		expect((await user.get(`/clients/${b.client_id}`)).body.data.summary).toMatchObject({ locations: 0, avg_rank: null });

		// Unassign it again: it stays in the organization without a client.
		res = await user.delete(`/clients/${a.client_id}/locations/${gbpLoc}`);
		expect(res.body.data).toMatchObject({ unassigned: true });
		expect((await user.get(`/clients/${a.client_id}`)).body.data.summary).toMatchObject({ locations: 1, avg_rank: 3 });
		expect((await user.get(`/locations/${gbpLoc}`)).body.data.client).toBeNull();
		// And assign it with the assign endpoint.
		res = await user.post(`/clients/${b.client_id}/locations`, { location_id: gbpLoc });
		expect(res.body.data).toMatchObject({ assigned: true, client_id: b.client_id });
		expect((await user.get('/clients')).body.data.clients.map((c: { name: string; locations_count: number }) => [c.name, c.locations_count])).toEqual([
			['Client A', 1],
			['Client B', 1],
		]);
	});

	it('flow 3: a client_user invited for client A sees only client A (locations, reports, dashboard), read-only', async () => {
		const { user, a, placesLoc, gbpLoc } = await agencyWithTwoLocations();
		// The owner creates a report for each location.
		for (const id of [placesLoc, gbpLoc]) expect((await user.post('/reports', { location_id: id, type: 'rank_tracker' })).status).toBe(202);

		let res = await user.post('/organization/invitations', { email: 'client.a@example.test', role: 'client_user', client_ids: [a.client_id] });
		expect(res.status).toBe(201);
		res = await api().post('/auth/invitations/inspect', { token: tokenIn(lastLink('invite', 'client.a@example.test')) });
		expect(res.body.data).toMatchObject({ role: 'client_user', account_exists: false });
		res = await api().post('/auth/invitations/accept', { token: tokenIn(lastLink('invite', 'client.a@example.test')), name: 'Casey Client', password: PASSWORD });
		expect(res.status).toBe(200);
		const clientUser = api(res.body.data.tokens.access.token);

		expect((await clientUser.get('/locations')).body.data.locations.map((l: { location_id: string }) => l.location_id)).toEqual([placesLoc]);
		expect((await clientUser.get(`/locations/${placesLoc}/rank-tracker`)).status).toBe(200);
		expect((await clientUser.get(`/locations/${gbpLoc}`)).status).toBe(404);
		expect((await clientUser.get(`/locations/${gbpLoc}/rank-tracker`)).status).toBe(404);
		const reports = (await clientUser.get('/reports')).body.data.reports;
		expect(reports.map((r: { location: { location_id: string } }) => r.location.location_id)).toEqual([placesLoc]);
		expect((await clientUser.get('/clients')).body.data.clients.map((c: { client_id: string }) => c.client_id)).toEqual([a.client_id]);
		expect((await clientUser.get('/dashboard')).status).toBe(200);

		// Read-only everywhere.
		for (const [method, path, body] of [
			['put', `/locations/${placesLoc}/tracking`, { keywords: ['dentist'] }],
			['post', '/locations', { place_id: 'ChIJflowPlumberAustin01' }],
			['post', '/reports', { location_id: placesLoc, type: 'rank_tracker' }],
			['post', `/locations/${placesLoc}/refresh`, {}],
			['post', '/clients', { name: 'X' }],
			['post', '/organization/invitations', { email: 'x@example.test', role: 'member' }],
		] as const) {
			res = await (clientUser[method] as (p: string, b: object) => request.Test)(path, body);
			expect([method, path, res.status]).toEqual([method, path, 403]);
		}
	});
});

describe('flow 4: limits', () => {
	const webhook = (event_type: string, resource: Record<string, unknown>, id: string) =>
		request(app)
			.post('/api/v1/subscription/paypal/webhook')
			.set({ 'paypal-auth-algo': 'SHA256withRSA', 'paypal-cert-url': 'https://api.sandbox.paypal.com/cert.pem', 'paypal-transmission-id': id, 'paypal-transmission-sig': 'sig', 'paypal-transmission-time': new Date().toISOString() })
			.send({ id, event_type, resource });

	it('trial allowance → subscribe → pay for an extra location slot → user limit 3 per paid location', async () => {
		const plan = await standardPlan();
		await BillingPlan.updateOne({ _id: plan._id }, { $set: { prices: [{ currency: 'USD', first_location_price: 49, additional_location_price: 19, effective_from: new Date('2026-01-01T00:00:00Z'), set_at: new Date() }] } });
		const { token, orgId } = await signUp('business', 'owner@limits.test', 'US');
		const user = api(token);

		// Trial: 1 location.
		let res = await user.get('/billing');
		expect(res.body.data).toMatchObject({ state: 'trialing', locations: { allowed: 1 } });
		expect((await user.post('/locations', { place_id: 'ChIJflowPlumberAustin01' })).status).toBe(201);
		res = await user.post('/locations', { place_id: 'ChIJflowPlumberAustin02' });
		expect(res.status).toBe(402);
		expect(res.body.data).toMatchObject({ reason: 'subscription_required' });

		// Subscribe (PayPal approval mocked; the webhooks activate it).
		res = await user.post('/billing/checkout');
		expect(res.status).toBe(201);
		expect(res.body.data).toMatchObject({ quantity: 1, currency: 'USD', monthly_amount: 49 });
		const sub = await Subscription.findOne({ organization_id: orgId, open: true }).lean();
		const periodEnd = new Date(Date.now() + 30 * 86_400_000);
		await webhook('BILLING.SUBSCRIPTION.ACTIVATED', { id: sub?.provider_subscription_id, status: 'ACTIVE', custom_id: String(sub?._id), start_time: new Date().toISOString(), billing_info: { next_billing_time: periodEnd.toISOString() } }, 'WH-A');
		await webhook('PAYMENT.SALE.COMPLETED', { id: 'SALE-1', amount: { total: '49.00', currency: 'USD' }, billing_agreement_id: sub?.provider_subscription_id, create_time: new Date().toISOString() }, 'WH-S');
		expect((await user.get('/billing')).body.data).toMatchObject({ state: 'active', locations: { allowed: 1 } });

		// At the paid quantity: 402 with a quote → pay for one slot → the add succeeds.
		res = await user.post('/locations', { place_id: 'ChIJflowPlumberAustin02' });
		expect(res.status).toBe(402);
		expect(res.body.data).toMatchObject({ reason: 'location_payment_required', quote: { quantity: 1, amount: expect.any(Number) } });
		res = await user.post('/billing/location-slots', { quantity: 1 });
		expect(res.status).toBe(201);
		expect(res.body.data.approve_url).toContain('paypal.com');
		res = await user.post(`/billing/orders/${res.body.data.provider_order_id}/capture`);
		expect(res.body.data).toMatchObject({ status: 'captured', billing: { locations: { allowed: 2 } } });
		expect((await user.post('/locations', { place_id: 'ChIJflowPlumberAustin02' })).status).toBe(201);

		// Users: 3 per paid location, pooled, owner included → 6.
		for (let i = 1; i <= 5; i += 1) expect((await user.post('/organization/invitations', { email: `m${i}@limits.test`, role: 'member' })).status).toBe(201);
		res = await user.post('/organization/invitations', { email: 'm6@limits.test', role: 'member' });
		expect(res.status).toBe(403);
		expect(res.body.data).toMatchObject({ reason: 'user_limit_reached', used: 6, limit: 6 });
	});

	it('after the trial without a subscription: read-only (402 on money-costing actions, reads still work)', async () => {
		const { token, orgId } = await signUp('business', 'owner@expired.test', 'US');
		const user = api(token);
		const locationId = (await user.post('/locations', { place_id: 'ChIJflowPlumberAustin01' })).body.data.location.location_id as string;
		await Organization.updateOne({ _id: new Types.ObjectId(orgId) }, { $set: { trial_ends_at: new Date(Date.now() - 1000) } });

		expect((await user.get('/billing')).body.data).toMatchObject({ state: 'inactive', read_only: true });
		for (const [method, path, body] of [
			['post', `/locations/${locationId}/refresh`, {}],
			['post', `/locations/${locationId}/rank-runs`, {}],
			['put', `/locations/${locationId}/tracking`, { keywords: ['plumber'] }],
			['post', '/locations', { place_id: 'ChIJflowPlumberAustin02' }],
			['post', '/reports', { location_id: locationId, type: 'rank_tracker' }],
		] as const) {
			const res = await (user[method] as (p: string, b: object) => request.Test)(path, body);
			expect([path, res.status, res.body.data?.reason]).toEqual([path, 402, 'subscription_required']);
		}
		for (const path of ['/locations', `/locations/${locationId}`, `/locations/${locationId}/overview`, '/dashboard', '/billing', '/billing/invoices']) {
			expect([path, (await user.get(path)).status]).toEqual([path, 200]);
		}
	});
});
