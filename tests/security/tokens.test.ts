import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { GBPPost, User } from '../../src/models';
import { revokeUserSessions } from '../../src/services/common/token.service';
import { clearDb, createLocation, createUser, ensureOrg, startTestDb } from '../helpers/mongoose';

// Phase 10 (AUDIT S15, S22, S23, S24, S25): user tokens, the legacy OTP / reset flows, account
// deletion and the remaining ownership checks, on the real app.

jest.mock('../../src/configs/mongoConnection', () => ({ agenda: {} }));
jest.mock('../../src/services/common/email.service', () => new Proxy({}, { get: () => jest.fn(async () => true) }));

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
