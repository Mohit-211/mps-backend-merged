import crypto from 'crypto';
import express from 'express';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import config from '../../src/configs/config';
import { Admin, Role } from '../../src/models';
import { signAdminToken } from '../../src/services/admin/adminToken';
import { apiErrorHandler } from '../../src/utils';
import { clearDb, createUser, startTestDb } from '../helpers/mongoose';

// Phase 10 (AUDIT S1, S14, S19, S22 admin): admin tokens, roles → permissions, OTP and password flows.

jest.mock('../../src/configs/mongoConnection', () => ({ agenda: {} }));

const sentOtps: string[] = [];
jest.mock('../../src/services/common/email.service', () => ({
	sendForgotPasswordOTP: jest.fn(async (_to: string, otp: string) => {
		sentOtps.push(otp);
		return true;
	}),
	sendAdminCredential: jest.fn(async () => true),
}));

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const adminAuthRoute = require('../../src/routes/v1/admin/adminAuth.route').default;
const adminBillingRoute = require('../../src/routes/v1/admin/billing.route').default;
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

const app = express();
app.use(express.json());
app.use('/api/v1/admin/auth', adminAuthRoute);
app.use('/api/v1/admin/billing', adminBillingRoute);
app.use(apiErrorHandler);

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const PASSWORD = 'Correct-Horse-9';

let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
}, 60000);
afterAll(async () => db.stop());
beforeEach(async () => {
	await clearDb();
	sentOtps.length = 0;
	await Role.create([
		{ name: 'Super Admin', role_id: config.roles.superAdmin, abbreviation: 'SA' },
		{ name: 'Admin', role_id: config.roles.admin, abbreviation: 'AD' },
		{ name: 'Editor', role_id: config.roles.editor, abbreviation: 'ED' },
	]);
});

const makeAdmin = (email: string, roleId: number) => Admin.create({ name: email.split('@')[0], email, role_id: roleId, password: bcrypt.hashSync(PASSWORD, 4) });
const login = async (email: string) => (await request(app).post('/api/v1/admin/auth/login').send({ email, password: PASSWORD })).body.data.token as string;

describe('admin tokens (S19)', () => {
	it('login gives a session token that opens the profile; the old hex-key tokens, user tokens and reset tokens do not', async () => {
		const admin = await makeAdmin('sa@test.dev', config.roles.superAdmin);
		const token = await login('sa@test.dev');
		expect(jwt.decode(token)).toMatchObject({ aud: 'mps-admin', iss: 'mypageseo', purpose: 'session', role_id: config.roles.superAdmin, sub: String(admin._id) });
		expect((await request(app).get('/api/v1/admin/auth/getProfile').set(bearer(token))).status).toBe(200);

		const oldStyle = jwt.sign({ id: String(admin._id), role_id: config.roles.superAdmin }, Buffer.from(config.constants.jwt.secret, 'hex'), { algorithm: 'HS256' });
		const emptyKey = jwt.sign({ sub: String(admin._id), role_id: config.roles.superAdmin, tv: 0, purpose: 'session' }, Buffer.alloc(0) as unknown as string, { algorithm: 'HS256', audience: 'mps-admin', issuer: 'mypageseo' });
		const { token: userToken } = await createUser('user@test.dev');
		const reset = signAdminToken({ sub: String(admin._id), role_id: config.roles.superAdmin, tv: 0 }, 'password_reset');
		const none = jwt.sign({ sub: String(admin._id), role_id: config.roles.superAdmin, tv: 0, purpose: 'session', aud: 'mps-admin', iss: 'mypageseo' }, '', { algorithm: 'none' as jwt.Algorithm });
		for (const t of [oldStyle, emptyKey, userToken, reset, none, 'garbage']) {
			expect((await request(app).get('/api/v1/admin/auth/getProfile').set(bearer(t))).status).toBe(401);
		}
		expect((await request(app).get('/api/v1/admin/auth/getProfile')).status).toBe(401);
	});

	it('wrong password and unknown email get the same answer; sign-in is rate-limited', async () => {
		await makeAdmin('sa@test.dev', config.roles.superAdmin);
		const wrong = await request(app).post('/api/v1/admin/auth/login').send({ email: 'sa@test.dev', password: 'nope-nope-1' });
		const unknown = await request(app).post('/api/v1/admin/auth/login').send({ email: 'x@test.dev', password: 'nope-nope-1' });
		expect([wrong.status, wrong.body.message]).toEqual([unknown.status, unknown.body.message]);
		let last = 0;
		for (let i = 0; i < 11; i++) last = (await request(app).post('/api/v1/admin/auth/login').send({ email: 'sa@test.dev', password: 'nope-nope-1' })).status;
		expect(last).toBe(429);
	});

	it('token_version revokes: a password change ends other sessions; a deactivated admin is out', async () => {
		await makeAdmin('sa@test.dev', config.roles.superAdmin);
		const first = await login('sa@test.dev');
		const change = await request(app).post('/api/v1/admin/auth/resetPassword').set(bearer(first)).send({ old_password: PASSWORD, new_password: 'New-Password-7', confirm_password: 'New-Password-7' });
		expect(change.status).toBe(200);
		expect((await request(app).get('/api/v1/admin/auth/getProfile').set(bearer(first))).status).toBe(401);
		expect((await request(app).get('/api/v1/admin/auth/getProfile').set(bearer(change.body.data.token))).status).toBe(200);
		await Admin.updateOne({ email: 'sa@test.dev' }, { $set: { is_active: false } });
		expect((await request(app).get('/api/v1/admin/auth/getProfile').set(bearer(change.body.data.token))).status).toBe(401);
	});
});

describe('roles → permissions (S1)', () => {
	it('admins.manage is super admin only; platform.read for admin; editors get 403 forbidden', async () => {
		await makeAdmin('sa@test.dev', config.roles.superAdmin);
		await makeAdmin('ad@test.dev', config.roles.admin);
		await makeAdmin('ed@test.dev', config.roles.editor);
		const [sa, ad, ed] = [await login('sa@test.dev'), await login('ad@test.dev'), await login('ed@test.dev')];
		const list = await request(app).get('/api/v1/admin/auth/getAllAdmins').set(bearer(sa));
		expect(list.status).toBe(200);
		for (const a of list.body.data) {
			for (const k of ['password', 'otp', 'remember_token', 'token_version']) expect(a[k]).toBeUndefined();
		}
		const denied = await request(app).get('/api/v1/admin/auth/getAllAdmins').set(bearer(ad));
		expect(denied.status).toBe(403);
		expect(denied.body.data).toMatchObject({ reason: 'forbidden', permission: 'admins.manage' });
		expect((await request(app).get('/api/v1/admin/billing/plans').set(bearer(ad))).status).toBe(200);
		expect((await request(app).get('/api/v1/admin/billing/plans').set(bearer(ed))).status).toBe(403);
		expect((await request(app).get('/api/v1/admin/billing/plans')).status).toBe(401);
		expect((await request(app).post('/api/v1/admin/auth/register').set(bearer(ad)).send({ email: 'n@test.dev', name: 'N', role_id: config.roles.superAdmin })).status).toBe(403);
		const created = await request(app).post('/api/v1/admin/auth/register').set(bearer(sa)).send({ email: 'N@Test.dev', name: 'N', role_id: config.roles.editor });
		expect(created.status).toBe(201);
		expect(created.body.data).toMatchObject({ email: 'n@test.dev' });
		expect(created.body.data.password).toBeUndefined();
	});

	it('no admin changes their own role; the last super admin stays; a role change revokes the target\'s tokens', async () => {
		const sa = await makeAdmin('sa@test.dev', config.roles.superAdmin);
		const ad = await makeAdmin('ad@test.dev', config.roles.admin);
		const saToken = await login('sa@test.dev');
		const adToken = await login('ad@test.dev');
		expect((await request(app).put('/api/v1/admin/auth/updateAdmin').set(bearer(saToken)).send({ id: String(sa._id), role_id: config.roles.editor })).body.data).toMatchObject({ reason: 'own_role' });
		expect((await request(app).delete('/api/v1/admin/auth/deleteAdmin').set(bearer(saToken)).send({ id: String(sa._id) })).body.data).toMatchObject({ reason: 'own_account' });
		expect((await request(app).put('/api/v1/admin/auth/updateAdmin').set(bearer(saToken)).send({ id: String(ad._id), role_id: config.roles.editor })).status).toBe(200);
		expect((await request(app).get('/api/v1/admin/auth/getProfile').set(bearer(adToken))).status).toBe(401);
	});
});

describe('OTP and forgot password (S14, S22 admin, S6)', () => {
	it('crypto OTP, 5 attempts, single-use reset token; operator objects are refused; unknown emails get the same answer', async () => {
		await makeAdmin('sa@test.dev', config.roles.superAdmin);
		const before = await login('sa@test.dev');
		const unknown = await request(app).post('/api/v1/admin/auth/sendOTP').send({ email: 'nobody@test.dev' });
		const known = await request(app).post('/api/v1/admin/auth/sendOTP').send({ email: 'sa@test.dev' });
		expect([unknown.status, unknown.body.data]).toEqual([known.status, known.body.data]);
		expect(sentOtps).toHaveLength(1);
		const injected = await request(app).post('/api/v1/admin/auth/verifyOTP').send({ email: { $gt: '' }, otp: sentOtps[0] });
		expect(injected.status).toBe(400);

		const wrong = String((Number(sentOtps[0]) + 1) % 1000000).padStart(6, '1');
		const verify = (otp: string) => request(app).post('/api/v1/admin/auth/verifyOTP').send({ email: 'sa@test.dev', otp, otp_type: 'FORGOT_PASSWORD' });
		for (let i = 0; i < 5; i++) expect((await verify(wrong)).status).toBe(400);
		expect((await verify(sentOtps[0])).body.data).toMatchObject({ reason: 'invalid_code' }); // locked after 5 misses

		await request(app).post('/api/v1/admin/auth/sendOTP').send({ email: 'sa@test.dev' });
		const ok = await verify(sentOtps[1]);
		expect(ok.status).toBe(200);
		const resetToken = ok.body.data.token as string;
		expect((await Admin.findOne({ email: 'sa@test.dev' }).lean())?.remember_token).toBe(crypto.createHash('sha256').update(resetToken).digest('hex'));
		const set = (t: string) => request(app).post('/api/v1/admin/auth/forgotPassword').send({ email: 'sa@test.dev', password: 'Brand-New-5', confirm_password: 'Brand-New-5', token: t });
		expect((await set(resetToken)).status).toBe(200);
		expect((await set(resetToken)).status).toBe(400); // single use
		expect((await request(app).get('/api/v1/admin/auth/getProfile').set(bearer(before))).status).toBe(401); // sessions revoked
		expect((await request(app).post('/api/v1/admin/auth/login').send({ email: 'sa@test.dev', password: 'Brand-New-5' })).status).toBe(200);
	});

	it('an expired OTP is refused', async () => {
		await makeAdmin('sa@test.dev', config.roles.superAdmin);
		await request(app).post('/api/v1/admin/auth/sendOTP').send({ email: 'sa@test.dev' });
		await Admin.updateOne({ email: 'sa@test.dev' }, { $set: { otp_expires_at: new Date(Date.now() - 1000) } });
		expect((await request(app).post('/api/v1/admin/auth/verifyOTP').send({ email: 'sa@test.dev', otp: sentOtps[0] })).status).toBe(400);
	});
});
