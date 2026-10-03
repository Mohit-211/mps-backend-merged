import bcrypt from 'bcryptjs';
import express from 'express';
import request from 'supertest';
import { Membership, Profile, User, UserLoginTiming, UserToken } from '../../src/models';
import { clearDb, createUser, ensureOrg, startTestDb } from '../helpers/mongoose';

// Phase 13b: /auth sessions (refresh with rotation, logout) and the account (me, change password,
// delete), replacing the legacy /user/auth and /user/profile routes.

jest.mock('../../src/configs/mongoConnection', () => ({ agenda: {} }));
jest.mock('../../src/configs/agenda', () => ({ getAgenda: () => ({ schedule: jest.fn(), cancel: jest.fn(async () => 0) }), stopAgenda: jest.fn() }));
jest.mock('../../src/services/common/email.service', () => new Proxy({}, { get: () => jest.fn(async () => true) }));

/* oxlint-disable typescript/no-var-requires */
const app: express.Express = require('../../src/app').default;
/* oxlint-enable typescript/no-var-requires */

const PASSWORD = 'secret123';
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
}, 60000);
afterAll(async () => db.stop());
beforeEach(clearDb);

const account = async (email = 'pat@test.dev') => {
	const { user } = await createUser(email);
	await User.updateOne({ _id: user._id }, { $set: { password: bcrypt.hashSync(PASSWORD, 4) } });
	await Profile.create({ user_id: user._id, name: 'Pat' });
	await ensureOrg(user._id);
	const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
	expect(res.status).toBe(200);
	return { user, access: res.body.data.tokens.access.token as string, refresh: res.body.data.tokens.refresh.token as string };
};

describe('/auth sessions', () => {
	it('login records the sign-in; refresh rotates the refresh token; logout ends the session', async () => {
		const { user, refresh } = await account();
		expect(await UserLoginTiming.countDocuments({ user_id: user._id })).toBe(1);
		const r1 = await request(app).post('/api/v1/auth/refresh').send({ refresh_token: refresh });
		expect(r1.status).toBe(200);
		const next = r1.body.data.tokens.refresh.token as string;
		expect(next).not.toBe(refresh);
		expect(r1.body.data.tokens.refresh.id).toBeUndefined();
		expect((await request(app).post('/api/v1/auth/refresh').send({ refresh_token: refresh })).status).toBe(401);
		expect((await request(app).get('/api/v1/auth/me').set(bearer(r1.body.data.tokens.access.token))).status).toBe(200);
		expect((await request(app).post('/api/v1/auth/logout').send({ refresh_token: next })).status).toBe(200);
		expect((await request(app).post('/api/v1/auth/refresh').send({ refresh_token: next })).status).toBe(401);
		expect((await UserLoginTiming.findOne({ user_id: user._id }).lean())?.logout_time_utc).toBeTruthy();
		expect((await request(app).post('/api/v1/auth/refresh').send({})).status).toBe(400);
	});
});

describe('/auth account', () => {
	it('me and PATCH me', async () => {
		const { access } = await account();
		let res = await request(app).get('/api/v1/auth/me').set(bearer(access));
		expect(res.body.data).toMatchObject({ email: 'pat@test.dev', name: 'Pat', mobile: null, organizations: [expect.objectContaining({ role: 'owner' })] });
		expect(res.body.data.last_login_at).toBeTruthy();
		expect(res.body.data.current_organization_id).toBe(res.body.data.organizations[0].organization_id);
		res = await request(app).patch('/api/v1/auth/me').set(bearer(access)).send({ name: 'Pat Doe', mobile: '+1 416 555 0100' });
		expect(res.body.data).toMatchObject({ name: 'Pat Doe', mobile: '+1 416 555 0100' });
		expect((await request(app).patch('/api/v1/auth/me').set(bearer(access)).send({})).status).toBe(400);
		expect((await request(app).get('/api/v1/auth/me')).status).toBe(401);
	});

	it('change password needs the current one and ends every other session', async () => {
		const { access, refresh } = await account();
		expect((await request(app).post('/api/v1/auth/change-password').set(bearer(access)).send({ current_password: 'wrong1234', new_password: 'n3w-Password' })).body.data).toMatchObject({ reason: 'wrong_password' });
		const res = await request(app).post('/api/v1/auth/change-password').set(bearer(access)).send({ current_password: PASSWORD, new_password: 'n3w-Password' });
		expect(res.status).toBe(200);
		expect((await request(app).get('/api/v1/auth/me').set(bearer(access))).status).toBe(401);
		expect((await request(app).post('/api/v1/auth/refresh').send({ refresh_token: refresh })).status).toBe(401);
		expect((await request(app).get('/api/v1/auth/me').set(bearer(res.body.data.tokens.access.token))).status).toBe(200);
		expect((await request(app).post('/api/v1/auth/login').send({ email: 'pat@test.dev', password: 'n3w-Password' })).status).toBe(200);
	});

	it('deactivate needs the password, ends memberships and sessions and deletes the account', async () => {
		const { user, access } = await account('bye@test.dev');
		expect((await request(app).post('/api/v1/auth/deactivate').set(bearer(access)).send({ password: 'nope' })).body.data).toMatchObject({ reason: 'wrong_password' });
		const res = await request(app).post('/api/v1/auth/deactivate').set(bearer(access)).send({ password: PASSWORD });
		expect(res.status).toBe(200);
		expect(await Membership.countDocuments({ user_id: user._id, status: 'active' })).toBe(0);
		expect(await User.countDocuments({ _id: user._id })).toBe(0);
		expect(await UserToken.countDocuments({ user_id: user._id })).toBe(0);
		expect((await request(app).get('/api/v1/auth/me').set(bearer(access))).status).toBe(401);
	});

	it('the legacy /user/auth session routes and /user/profile are gone', async () => {
		const { access } = await account();
		for (const [method, url] of [['post', '/api/v1/user/auth/refresh-auth'], ['post', '/api/v1/user/auth/logout'], ['get', '/api/v1/user/auth/deactivate'], ['post', '/api/v1/user/auth/reset-password'], ['get', '/api/v1/user/profile']] as const) {
			expect((await request(app)[method](url).set(bearer(access))).status).toBe(404);
		}
	});
});
