import bcrypt from 'bcryptjs';
import express from 'express';
import request from 'supertest';
import { Types } from 'mongoose';
import { AuditLog, Invoice, Organization, Subscription, User, UserToken } from '../../src/models';
import { createAdmin } from '../helpers/admin';
import { activateBilling } from '../helpers/billing';
import { addMember, clearDb, createLocation, createUser, ensureOrg, startTestDb } from '../helpers/mongoose';

// Phase 13b: the admin panel (users, organizations, overview). Guards: tests/routes/adminGuards.

jest.mock('../../src/configs/mongoConnection', () => ({ agenda: {} }));
jest.mock('../../src/configs/agenda', () => ({ getAgenda: () => ({ schedule: jest.fn(async () => ({})), cancel: jest.fn(async () => 0) }), stopAgenda: jest.fn() }));
jest.mock('../../src/services/common/email.service', () => new Proxy({}, { get: () => jest.fn(async () => true) }));

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const app: express.Express = require('../../src/app').default;
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

const DAY = 86_400_000;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
let db: { stop: () => Promise<void> };
let admin: string;
beforeAll(async () => {
	db = await startTestDb();
}, 60000);
afterAll(async () => db.stop());
beforeEach(async () => {
	await clearDb();
	admin = (await createAdmin('admin', 'Panel Admin')).token;
});

describe('admin users', () => {
	it('list, search, detail; disable ends sessions and blocks the token; enable; verify; audit', async () => {
		const { user, token } = await createUser('pat@shop.test');
		await ensureOrg(user._id);
		await UserToken.create({ user_id: user._id, token: 'x', token_type: 'REFRESH', expired_at: new Date(Date.now() + DAY) });
		let res = await request(app).get('/api/v1/admin/users?q=pat@').set(bearer(admin));
		expect(res.body.data).toMatchObject({ total: 1, users: [{ email: 'pat@shop.test', organizations: 1, disabled: false }] });
		res = await request(app).get(`/api/v1/admin/users/${String(user._id)}`).set(bearer(admin));
		expect(res.body.data).toMatchObject({ email: 'pat@shop.test', memberships: [expect.objectContaining({ role: 'owner' })], google_connections: [] });

		expect((await request(app).get('/api/v1/dashboard').set(bearer(token))).status).toBe(200);
		res = await request(app).post(`/api/v1/admin/users/${String(user._id)}/disable`).set(bearer(admin)).send({ reason: 'abuse report' });
		expect(res.body.data).toMatchObject({ disabled: true });
		expect((await request(app).get('/api/v1/dashboard').set(bearer(token))).status).toBe(401);
		expect(await UserToken.countDocuments({ user_id: user._id })).toBe(0);
		expect((await request(app).post(`/api/v1/admin/users/${String(user._id)}/disable`).set(bearer(admin)).send({})).status).toBe(400);
		res = await request(app).post(`/api/v1/admin/users/${String(user._id)}/enable`).set(bearer(admin));
		expect(res.body.data).toMatchObject({ disabled: false, status: 'ACCEPTED' });

		const pending = await User.create({ email: 'new@shop.test', password: bcrypt.hashSync('x1234567', 4), role_id: 9, user_type: 'BUSINESS', status: 'PENDING', email_verified_at: null });
		expect((await request(app).post(`/api/v1/admin/users/${String(pending._id)}/resend-verification`).set(bearer(admin))).status).toBe(200);
		expect((await request(app).post(`/api/v1/admin/users/${String(pending._id)}/verify`).set(bearer(admin))).body.data.email_verified_at).toBeTruthy();
		expect((await request(app).post(`/api/v1/admin/users/${String(pending._id)}/verify`).set(bearer(admin))).body.data.reason).toBe('already_verified');
		expect(await AuditLog.find({ action: /^admin\.user\./ }).distinct('action')).toEqual(expect.arrayContaining(['admin.user.disable', 'admin.user.enable', 'admin.user.verify', 'admin.user.resend_verification']));
	});
});

describe('admin organizations', () => {
	it('list with billing state and filters; detail; suspend makes it read-only (402); limit overrides; trial', async () => {
		const { user, token } = await createUser('owner@agency.test');
		const org = await ensureOrg(user._id, 'agency');
		const orgId = org._id as Types.ObjectId;
		const member = await createUser('m@agency.test');
		await addMember(orgId, member.user._id, 'member');
		const loc = await createLocation(user._id as Types.ObjectId);
		const other = await createUser('b@biz.test');
		await ensureOrg(other.user._id);
		await Organization.updateOne({ owner_user_id: other.user._id }, { $set: { trial_ends_at: new Date(Date.now() - DAY) } });

		let res = await request(app).get('/api/v1/admin/organizations').set(bearer(admin));
		expect(res.body.data.total).toBe(2);
		res = await request(app).get('/api/v1/admin/organizations?state=inactive').set(bearer(admin));
		expect(res.body.data.organizations.map((o: { owner_email: string }) => o.owner_email)).toEqual(['b@biz.test']);
		res = await request(app).get('/api/v1/admin/organizations?type=agency&q=owner@').set(bearer(admin));
		expect(res.body.data.organizations).toEqual([expect.objectContaining({ type: 'agency', state: 'trialing', plan: 'standard' })]);

		res = await request(app).get(`/api/v1/admin/organizations/${String(orgId)}`).set(bearer(admin));
		expect(res.body.data).toMatchObject({ organization: { owner: { email: 'owner@agency.test' } }, locations: [{ id: String(loc._id) }], clients: 0, billing: { state: 'trialing' } });
		expect(res.body.data.members).toHaveLength(2);

		res = await request(app).post(`/api/v1/admin/organizations/${String(orgId)}/suspend`).set(bearer(admin)).send({ reason: 'chargeback' });
		expect(res.body.data.organization.suspended_reason).toBe('chargeback');
		const blocked = await request(app).post(`/api/v1/locations/${String(loc._id)}/refresh`).set(bearer(token)).send({});
		expect([blocked.status, blocked.body.data.reason]).toEqual([402, 'organization_suspended']);
		expect((await request(app).get('/api/v1/dashboard').set(bearer(token))).status).toBe(200);
		expect((await request(app).post(`/api/v1/admin/organizations/${String(orgId)}/suspend`).set(bearer(admin)).send({ reason: 'again' })).body.data.reason).toBe('already_suspended');
		res = await request(app).post(`/api/v1/admin/organizations/${String(orgId)}/unsuspend`).set(bearer(admin)).send({ note: 'resolved' });
		expect(res.body.data.organization.suspended_at).toBeNull();

		await activateBilling(orgId, { quantity: 2 });
		res = await request(app).patch(`/api/v1/admin/organizations/${String(orgId)}/limits`).set(bearer(admin)).send({ max_locations: 50, extra_users: 4 });
		expect(res.body.data.organization.limit_overrides).toEqual({ max_locations: 50, extra_users: 4 });
		const usage = await request(app).get('/api/v1/organization/usage').set(bearer(token));
		expect(usage.body.data).toMatchObject({ locations: { max: 50 }, users: { limit: 10 } });

		const until = new Date(Date.now() + 30 * DAY).toISOString();
		res = await request(app).patch(`/api/v1/admin/organizations/${String(orgId)}/trial`).set(bearer(admin)).send({ trial_ends_at: until });
		expect(new Date(res.body.data.trial_ends_at).toISOString()).toBe(until);
		expect(await AuditLog.find({ organization_id: orgId }).distinct('action')).toEqual(expect.arrayContaining(['admin.organization.suspend', 'admin.organization.unsuspend', 'admin.organization.limits', 'admin.organization.trial']));
	});
});

describe('admin overview', () => {
	it('counts organizations by type and state, MRR per currency, trials ending, token sales, signups', async () => {
		const a = await createUser('a@x.test');
		const orgA = await ensureOrg(a.user._id, 'agency');
		await activateBilling(orgA._id as Types.ObjectId, { quantity: 3, comp: false, price: { first: 100, additional: 30 } });
		const b = await createUser('b@x.test');
		await ensureOrg(b.user._id);
		await Organization.updateOne({ owner_user_id: b.user._id }, { $set: { trial_ends_at: new Date(Date.now() + 3 * DAY) } });
		await Invoice.create({ number: 'INV-2026-000001', organization_id: orgA._id, kind: 'token_pack', status: 'paid', currency: 'CAD', lines: [], tax_lines: [], total: 20, issued_at: new Date(), paid_at: new Date(), customer: { name: 'A', email: null, address: [] }, seller: { name: 'S', email: null, address: [], tax_id: null } });
		const res = await request(app).get('/api/v1/admin/overview').set(bearer(admin));
		expect(res.status).toBe(200);
		expect(res.body.data).toMatchObject({
			organizations: { total: 2, by_type: { agency: 1, business: 1 }, by_state: { active: 1, trialing: 1 } },
			subscriptions: { paying: 1, past_due: 0, mrr: { CAD: 160 } },
			trials_ending_7d: 1,
			token_sales_30d: { CAD: { count: 1, total: 20 } },
			signups_30d: { users: 2, organizations: 2 },
			open_tickets: 0,
		});
		expect(await Subscription.countDocuments()).toBe(1);
	});
});
