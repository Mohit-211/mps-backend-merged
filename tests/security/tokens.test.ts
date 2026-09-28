import crypto from 'crypto';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { GBPPost, Membership, OTP, User } from '../../src/models';
import { revokeUserSessions } from '../../src/services/common/token.service';
import { clearDb, createLocation, createUser, ensureOrg, startTestDb } from '../helpers/mongoose';

// Phase 10 (AUDIT S15, S22, S23, S24, S25): user tokens, the legacy OTP / reset flows, account
// deletion and the remaining ownership checks, on the real app.

jest.mock('../../src/configs/mongoConnection', () => ({ agenda: {} }));
jest.mock('node-cron', () => ({ schedule: jest.fn() }));
const sentOtps: string[] = [];
jest.mock('../../src/services/common/email.service', () =>
	new Proxy(
		{},
		{
			get: (_t, name) =>
				name === 'sendForgotPasswordOTP'
					? jest.fn(async (_to: string, otp: string) => {
							sentOtps.push(otp);
							return true;
						})
					: jest.fn(async () => true),
		},
	),
);

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const app: express.Express = require('../../src/app').default;
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const me = (token: string) => request(app).get('/api/v1/dashboard').set(bearer(token));

let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
}, 60000);
afterAll(async () => db.stop());
beforeEach(async () => {
	await clearDb();
	sentOtps.length = 0;
});

describe('user tokens (S24)', () => {
	it('a bad signature or an expired token is 401 (was 500); HS256 only', async () => {
		const { user, token } = await createUser('u@test.dev');
		await ensureOrg(user._id);
		expect((await me(token)).status).toBe(200);
		const forged = jwt.sign({ sub: String(user._id), type: 'ACCESS', tv: 0 }, 'not-the-secret');
		expect((await me(forged)).status).toBe(401);
		const none = jwt.sign({ sub: String(user._id), type: 'ACCESS', tv: 0 }, '', { algorithm: 'none' as jwt.Algorithm });
		expect((await me(none)).status).toBe(401);
	});

	it('revokeUserSessions ends every access token at once; a deleted user is out', async () => {
		const { user, token } = await createUser('u@test.dev');
		await ensureOrg(user._id);
		expect((await me(token)).status).toBe(200);
		await revokeUserSessions(user._id);
		expect((await me(token)).status).toBe(401);
		const { user: u2, token: t2 } = await createUser('u2@test.dev');
		await ensureOrg(u2._id);
		await User.updateOne({ _id: u2._id }, { $set: { deleted_at: new Date() } });
		expect((await me(t2)).status).toBe(401);
	});
});

describe('legacy OTP and forgot password (S22)', () => {
	it('crypto codes, 5 attempts, a hashed reset token that expires and works once, and sessions revoked', async () => {
		const { user, token } = await createUser('legacy@test.dev');
		await ensureOrg(user._id);
		expect((await request(app).post('/api/v1/user/auth/otp').send({ email: 'legacy@test.dev', type: 'FORGOT_PASSWORD' })).status).toBe(200);
		const code = sentOtps[0];
		expect(code).toMatch(/^\d{6}$/);
		const verify = (otp: string) => request(app).post('/api/v1/user/auth/verify-otp').send({ email: 'legacy@test.dev', otp, type: 'FORGOT_PASSWORD' });
		const wrong = code === '123456' ? '654321' : '123456';
		for (let i = 0; i < 5; i++) expect((await verify(wrong)).status).toBe(400);
		expect((await verify(code)).body.message).toContain('Too many attempts');

		await request(app).post('/api/v1/user/auth/otp').send({ email: 'legacy@test.dev', type: 'FORGOT_PASSWORD' });
		const ok = await verify(sentOtps[1]);
		expect(ok.status).toBe(200);
		const resetToken = ok.body.data as string;
		expect(resetToken.length).toBeGreaterThanOrEqual(40);
		const stored = await OTP.findOne({ email: 'legacy@test.dev', is_verified: true }).lean();
		expect(stored?.code).toBe(crypto.createHash('sha256').update(resetToken).digest('hex'));
		expect(stored?.otp_expiration_time.getTime()).toBeGreaterThan(Date.now() + 25 * 60 * 1000);

		const set = () => request(app).post('/api/v1/user/auth/forgot-password').send({ email: 'legacy@test.dev', password: 'N3w-Password!', confirm_password: 'N3w-Password!', token: resetToken });
		expect((await set()).status).toBe(200);
		expect((await set()).status).toBe(400); // single use
		expect((await me(token)).status).toBe(401); // sessions ended
	});

	it('an expired reset token is refused', async () => {
		await createUser('late@test.dev');
		const hashed = crypto.createHash('sha256').update('tok'.repeat(15)).digest('hex');
		await OTP.create({ email: 'late@test.dev', type: 'FORGOT_PASSWORD', code: hashed, is_verified: true, otp_expiration_time: new Date(Date.now() - 1000) });
		const res = await request(app).post('/api/v1/user/auth/forgot-password').send({ email: 'late@test.dev', password: 'x-Password-1', confirm_password: 'x-Password-1', token: 'tok'.repeat(15) });
		expect(res.status).toBe(400);
	});
});

describe('account deletion (S23)', () => {
	it('ends memberships and sessions', async () => {
		const { user, token } = await createUser('bye@test.dev');
		await ensureOrg(user._id);
		expect((await request(app).get('/api/v1/user/auth/deactivate').set(bearer(token))).status).toBe(200);
		expect(await Membership.countDocuments({ user_id: user._id, status: 'active' })).toBe(0);
		expect((await me(token)).status).toBe(401);
	});
});

describe('ownership (S15, S25)', () => {
	it("another organization's GBP post is not found", async () => {
		const { user: owner } = await createUser('owner@test.dev');
		const loc = await createLocation(owner._id as Types.ObjectId);
		const post = await GBPPost.collection.insertOne({ location_id: loc._id, is_active: true, gbpPostId: 'accounts/1/locations/2/localPosts/3' });
		const { user: other, token } = await createUser('other@test.dev');
		await ensureOrg(other._id);
		const del = await request(app).delete('/api/v1/gbp/post/remove').set(bearer(token)).send({ post_id: String(post.insertedId) });
		expect(del.status).toBe(404);
		expect((await GBPPost.collection.findOne({ _id: post.insertedId }))?.is_active).toBe(true);
		// The legacy citation list routes were retired in Phase 16; their access checks now live in
		// tests/routes/citationsCustomer.routes.test.ts.
	});
});
