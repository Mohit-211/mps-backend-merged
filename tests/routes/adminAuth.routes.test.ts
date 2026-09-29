import express from 'express';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import config from '../../src/configs/config';
import { Admin, AuditLog, AuthLink, Role } from '../../src/models';
import { apiErrorHandler } from '../../src/utils';
import { clearDb, createUser, startTestDb } from '../helpers/mongoose';

// Phase 10 (AUDIT S1, S19): admin tokens and roles → permissions. 13b: sign-in and password links (no OTP),
// admin accounts at /admin/admins (a new admin sets the first password through an emailed link).

jest.mock('../../src/configs/mongoConnection', () => ({ agenda: {} }));

const sentLinks: { to: string; link: string; purpose: string }[] = [];
jest.mock('../../src/services/common/email.service', () => ({
	sendAdminPasswordLinkEmail: jest.fn(async (to: string, link: string, purpose: string) => sentLinks.push({ to, link, purpose }) > 0),
}));

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const adminAuthRoute = require('../../src/routes/v1/admin/adminAuth.route').default;
const adminsRoute = require('../../src/routes/v1/admin/admins.route').default;
const adminBillingRoute = require('../../src/routes/v1/admin/billing.route').default;
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

const app = express();
app.use(express.json());
app.use('/api/v1/admin/auth', adminAuthRoute);
app.use('/api/v1/admin/admins', adminsRoute);
app.use('/api/v1/admin/billing', adminBillingRoute);
app.use(apiErrorHandler);

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const PASSWORD = 'Correct-Horse-9';
const tokenOf = (link: string) => new URL(link).searchParams.get('token') as string;

let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
	await Promise.all([AuthLink.syncIndexes(), Admin.syncIndexes()]);
}, 60000);
afterAll(async () => db.stop());
beforeEach(async () => {
	await clearDb();
	sentLinks.length = 0;
	await Role.create([
		{ name: 'Super Admin', role_id: config.roles.superAdmin, abbreviation: 'SA' },
		{ name: 'Admin', role_id: config.roles.admin, abbreviation: 'AD' },
		{ name: 'Editor', role_id: config.roles.editor, abbreviation: 'ED' },
	]);
});

const makeAdmin = (email: string, roleId: number) => Admin.create({ name: email.split('@')[0], email, role_id: roleId, password: bcrypt.hashSync(PASSWORD, 4) });
const login = async (email: string, password = PASSWORD) => (await request(app).post('/api/v1/admin/auth/login').send({ email, password })).body.data?.token as string;
const reset = (token: string, password = 'Brand-New-5', confirm = password) =>
	request(app).post('/api/v1/admin/auth/reset-password').send({ token, password, confirm_password: confirm });

describe('admin tokens (S19)', () => {
	it('login gives a session token that opens /me; the old hex-key tokens, user tokens and unsigned tokens do not', async () => {
		const admin = await makeAdmin('sa@test.dev', config.roles.superAdmin);
		const res = await request(app).post('/api/v1/admin/auth/login').send({ email: 'SA@test.dev', password: PASSWORD });
		expect(res.status).toBe(200);
		expect(res.body.data.admin).toMatchObject({ email: 'sa@test.dev', role_name: 'Super Admin', password_set: true, permissions: expect.arrayContaining(['admins.manage']) });
		const token = res.body.data.token as string;
		expect(jwt.decode(token)).toMatchObject({ aud: 'mps-admin', iss: 'mypageseo', purpose: 'session', role_id: config.roles.superAdmin, sub: String(admin._id) });
		const me = await request(app).get('/api/v1/admin/auth/me').set(bearer(token));
		expect(me.status).toBe(200);
		expect(me.body.data.password).toBeUndefined();
		expect((await Admin.findById(admin._id).lean())?.last_login_at).toBeInstanceOf(Date);

		const oldStyle = jwt.sign({ id: String(admin._id), role_id: config.roles.superAdmin }, Buffer.from(config.constants.jwt.secret, 'hex'), { algorithm: 'HS256' });
		const emptyKey = jwt.sign({ sub: String(admin._id), role_id: config.roles.superAdmin, tv: 0, purpose: 'session' }, Buffer.alloc(0) as unknown as string, { algorithm: 'HS256', audience: 'mps-admin', issuer: 'mypageseo' });
		const { token: userToken } = await createUser('user@test.dev');
		const none = jwt.sign({ sub: String(admin._id), role_id: config.roles.superAdmin, tv: 0, purpose: 'session', aud: 'mps-admin', iss: 'mypageseo' }, '', { algorithm: 'none' as jwt.Algorithm });
		for (const t of [oldStyle, emptyKey, userToken, none, 'garbage']) {
			expect((await request(app).get('/api/v1/admin/auth/me').set(bearer(t))).status).toBe(401);
		}
		expect((await request(app).get('/api/v1/admin/auth/me')).status).toBe(401);
	});

	it('wrong password and unknown email get the same answer; sign-in is rate-limited', async () => {
		await makeAdmin('sa@test.dev', config.roles.superAdmin);
		const wrong = await request(app).post('/api/v1/admin/auth/login').send({ email: 'sa@test.dev', password: 'nope-nope-1' });
		const unknown = await request(app).post('/api/v1/admin/auth/login').send({ email: 'x@test.dev', password: 'nope-nope-1' });
		expect([wrong.status, wrong.body.message]).toEqual([unknown.status, unknown.body.message]);
		expect((await request(app).post('/api/v1/admin/auth/login').send({ email: { $gt: '' }, password: 'x' })).status).toBe(400);
		let last = 0;
		for (let i = 0; i < 11; i++) last = (await request(app).post('/api/v1/admin/auth/login').send({ email: 'sa@test.dev', password: 'nope-nope-1' })).status;
		expect(last).toBe(429);
	});

	it('change-password needs the current one and matching passwords; it ends other sessions; a deactivated admin is out', async () => {
		await makeAdmin('sa@test.dev', config.roles.superAdmin);
		const first = await login('sa@test.dev');
		const change = (body: Record<string, string>) => request(app).post('/api/v1/admin/auth/change-password').set(bearer(first)).send(body);
		expect((await change({ current_password: 'wrong-pass-1', new_password: 'New-Password-7', confirm_password: 'New-Password-7' })).body.data).toMatchObject({ reason: 'wrong_password' });
		expect((await change({ current_password: PASSWORD, new_password: 'New-Password-7', confirm_password: 'Other-Password-7' })).body.data).toMatchObject({ reason: 'passwords_do_not_match' });
		expect((await change({ current_password: PASSWORD, new_password: 'short', confirm_password: 'short' })).status).toBe(400);
		const ok = await change({ current_password: PASSWORD, new_password: 'New-Password-7', confirm_password: 'New-Password-7' });
		expect(ok.status).toBe(200);
		expect((await request(app).get('/api/v1/admin/auth/me').set(bearer(first))).status).toBe(401);
		expect((await request(app).get('/api/v1/admin/auth/me').set(bearer(ok.body.data.token))).status).toBe(200);
		await Admin.updateOne({ email: 'sa@test.dev' }, { $set: { is_active: false } });
		expect((await request(app).get('/api/v1/admin/auth/me').set(bearer(ok.body.data.token))).status).toBe(401);
	});
});

describe('roles → permissions and admin accounts (S1)', () => {
	it('admins.manage is super admin only; billing for admin; editors get 403 forbidden', async () => {
		await makeAdmin('sa@test.dev', config.roles.superAdmin);
		await makeAdmin('ad@test.dev', config.roles.admin);
		await makeAdmin('ed@test.dev', config.roles.editor);
		const [sa, ad, ed] = [await login('sa@test.dev'), await login('ad@test.dev'), await login('ed@test.dev')];
		const list = await request(app).get('/api/v1/admin/admins').set(bearer(sa));
		expect(list.status).toBe(200);
		expect(list.body.data).toHaveLength(3);
		for (const a of list.body.data) {
			for (const k of ['password', 'token_version']) expect(a[k]).toBeUndefined();
		}
		const denied = await request(app).get('/api/v1/admin/admins').set(bearer(ad));
		expect(denied.status).toBe(403);
		expect(denied.body.data).toMatchObject({ reason: 'forbidden', permission: 'admins.manage' });
		expect((await request(app).get('/api/v1/admin/billing/plans').set(bearer(ad))).status).toBe(200);
		expect((await request(app).get('/api/v1/admin/billing/plans').set(bearer(ed))).status).toBe(403);
		expect((await request(app).get('/api/v1/admin/admins/not-an-id').set(bearer(sa))).status).toBe(404);
	});

	it('a new admin has no password and sets it through the emailed link (single use); it can then sign in', async () => {
		await makeAdmin('sa@test.dev', config.roles.superAdmin);
		const sa = await login('sa@test.dev');
		expect((await request(app).post('/api/v1/admin/admins').set(bearer(sa)).send({ email: 'n@test.dev', name: 'N', role_id: 99 })).body.data).toMatchObject({ reason: 'invalid_role' });
		const created = await request(app).post('/api/v1/admin/admins').set(bearer(sa)).send({ email: 'N@Test.dev', name: 'N', role_id: config.roles.editor });
		expect(created.status).toBe(201);
		expect(created.body.data).toMatchObject({ email: 'n@test.dev', role_name: 'Editor', password_set: false, is_active: true, password_link_sent: true });
		expect((await request(app).post('/api/v1/admin/admins').set(bearer(sa)).send({ email: 'n@test.dev', name: 'N', role_id: config.roles.editor })).body.data).toMatchObject({ reason: 'email_taken' });
		expect(sentLinks).toEqual([{ to: 'n@test.dev', link: expect.stringMatching(/^http:\/\/localhost:3001\/reset-password\?token=[A-Za-z0-9_-]{43}$/), purpose: 'welcome' }]);
		expect(await login('n@test.dev', '')).toBeUndefined();

		// A resend replaces the first link.
		const resend = await request(app).post(`/api/v1/admin/admins/${created.body.data.id}/password-link`).set(bearer(sa));
		expect(resend.body.data).toMatchObject({ password_link_sent: true, purpose: 'set_password' });
		expect((await reset(tokenOf(sentLinks[0].link))).body.data).toMatchObject({ reason: 'link_invalid' });
		expect((await reset(tokenOf(sentLinks[1].link))).status).toBe(200);
		expect((await reset(tokenOf(sentLinks[1].link))).body.data).toMatchObject({ reason: 'link_invalid' }); // single use
		expect(await login('n@test.dev', 'Brand-New-5')).toEqual(expect.any(String));
		expect(await AuditLog.countDocuments({ action: { $in: ['admin.create', 'admin.password_link'] } })).toBe(2);
	});

	it('no admin changes their own role or deactivates themselves; the last super admin stays; a role change revokes the target\'s tokens', async () => {
		const sa = await makeAdmin('sa@test.dev', config.roles.superAdmin);
		const ad = await makeAdmin('ad@test.dev', config.roles.admin);
		const saToken = await login('sa@test.dev');
		const adToken = await login('ad@test.dev');
		const patch = (id: unknown, body: Record<string, unknown>) => request(app).patch(`/api/v1/admin/admins/${String(id)}`).set(bearer(saToken)).send(body);
		expect((await patch(sa._id, { role_id: config.roles.editor })).body.data).toMatchObject({ reason: 'own_role' });
		expect((await patch(sa._id, { is_active: false })).body.data).toMatchObject({ reason: 'own_account' });
		expect((await patch(ad._id, { role_id: config.roles.editor })).status).toBe(200);
		expect((await request(app).get('/api/v1/admin/auth/me').set(bearer(adToken))).status).toBe(401);
		// Deactivation (admins are never deleted).
		expect((await patch(ad._id, { is_active: false })).body.data).toMatchObject({ is_active: false });
		expect(await login('ad@test.dev')).toBeUndefined();
		expect(await Admin.countDocuments()).toBe(2);
	});
});

describe('forgot password by link (13b, no OTP)', () => {
	it('same answer for unknown emails; a 60-minute single-use link; a newer link replaces older ones; every session ends', async () => {
		await makeAdmin('sa@test.dev', config.roles.superAdmin);
		const before = await login('sa@test.dev');
		const unknown = await request(app).post('/api/v1/admin/auth/forgot-password').send({ email: 'nobody@test.dev' });
		const known = await request(app).post('/api/v1/admin/auth/forgot-password').send({ email: 'sa@test.dev' });
		expect([unknown.status, unknown.body.data]).toEqual([known.status, known.body.data]);
		expect(known.body.data).toEqual({ reset: 'sent_if_account_exists' });
		expect(sentLinks).toHaveLength(1);
		expect(sentLinks[0].purpose).toBe('reset');
		const link = await AuthLink.findOne({ subject_kind: 'admin' }).lean();
		expect(link?.expires_at.getTime()).toBeGreaterThan(Date.now() + 59 * 60_000);
		expect(link?.expires_at.getTime()).toBeLessThanOrEqual(Date.now() + 60 * 60_000);

		await request(app).post('/api/v1/admin/auth/forgot-password').send({ email: 'sa@test.dev' });
		expect((await reset(tokenOf(sentLinks[0].link))).body.data).toMatchObject({ reason: 'link_invalid' });
		expect((await reset(tokenOf(sentLinks[1].link), 'Brand-New-5', 'Other-New-5')).body.data).toMatchObject({ reason: 'passwords_do_not_match' });
		expect((await reset('not a token')).body.data).toMatchObject({ reason: 'link_invalid' });
		expect((await reset(tokenOf(sentLinks[1].link))).status).toBe(200);
		expect((await request(app).get('/api/v1/admin/auth/me').set(bearer(before))).status).toBe(401);
		expect(await login('sa@test.dev', 'Brand-New-5')).toEqual(expect.any(String));
	});

	it('an expired link answers link_expired', async () => {
		await makeAdmin('sa@test.dev', config.roles.superAdmin);
		await request(app).post('/api/v1/admin/auth/forgot-password').send({ email: 'sa@test.dev' });
		await AuthLink.updateMany({}, { $set: { expires_at: new Date(Date.now() - 1000) } });
		expect((await reset(tokenOf(sentLinks[0].link))).body.data).toMatchObject({ reason: 'link_expired' });
	});
});
