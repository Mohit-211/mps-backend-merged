import express from 'express';
import request from 'supertest';
import { Types } from 'mongoose';
import { queryTypesArr } from '../../src/configs/constantTypes';
import { Client, GbpReview, Location } from '../../src/models';
import { apiErrorHandler, getQueryParams } from '../../src/utils';
import { addMember, clearDb, createLocation, createUser, ensureOrg, startTestDb } from '../helpers/mongoose';

// Phase 18: the review routes: auth, roles (client_user read-only), validation. Service behaviour is in
// tests/services/reviews/reviews.service.test.ts.

jest.mock('../../src/configs/mongoConnection', () => ({ agenda: {} }));
jest.mock('../../src/configs/agenda', () => ({ getAgenda: () => ({ schedule: jest.fn(), cancel: jest.fn() }), stopAgenda: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const reviewsRoute = require('../../src/routes/v1/common/reviews.route').default;

const app = express();
app.use(express.json());
app.use(getQueryParams(queryTypesArr));
app.use('/api/v1/locations', reviewsRoute);
app.use(apiErrorHandler);

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
}, 60000);
afterAll(async () => db.stop());
beforeEach(async () => clearDb());

const setup = async () => {
	const owner = await createUser('owner@rev.dev');
	const org = await ensureOrg(owner.user._id);
	const loc = await createLocation(owner.user._id as Types.ObjectId);
	const r = await GbpReview.create({ location_id: loc._id, review_name: 'accounts/1/locations/1/reviews/a', rating: 5, comment: 'Great', reviewer: { display_name: 'A', is_anonymous: false }, synced_at: new Date() });
	return { orgId: org._id as Types.ObjectId, owner: owner.token, base: `/api/v1/locations/${String(loc._id)}/reviews`, reviewId: String(r._id) };
};

describe('review routes', () => {
	it('401 without a token; the owner reads the list and summary', async () => {
		const { owner, base } = await setup();
		expect((await request(app).get(base)).status).toBe(401);
		const list = await request(app).get(`${base}?rating=4,5&sort=newest`).set(auth(owner));
		expect(list.status).toBe(200);
		expect(list.body.data).toMatchObject({ total: 1, reviews: [{ rating: 5, ai_reply_eligible: true }], attribution: { provider: 'Google' } });
		const summary = await request(app).get(`${base}/summary`).set(auth(owner));
		expect(summary.body.data).toMatchObject({ stats: { total: 1 }, ai: { configured: false } });
	});

	it('a client user reads its client\'s reviews but cannot change anything (403 read_only)', async () => {
		const { orgId, base, reviewId } = await setup();
		const [client] = await Client.create([{ organization_id: orgId, company_name: 'C', name: 'C' }] as never[]);
		await Location.updateMany({}, { $set: { client_id: client._id } });
		const viewer = await createUser('client@rev.dev');
		await addMember(orgId, viewer.user._id as Types.ObjectId, 'client_user', [client._id as Types.ObjectId]);
		expect((await request(app).get(base).set(auth(viewer.token))).status).toBe(200);
		const res = await request(app).post(`${base}/drafts`).set(auth(viewer.token)).send({ review_ids: [reviewId] });
		expect(res.status).toBe(403);
		expect((await request(app).put(`${base}/${reviewId}/draft`).set(auth(viewer.token)).send({ text: 'x' })).status).toBe(403);
	});

	it('validates input: review ids, the per-request cap, draft text, report status', async () => {
		const { owner, base, reviewId } = await setup();
		for (const body of [{}, { review_ids: [] }, { review_ids: ['nope'] }, { review_ids: Array.from({ length: 21 }, () => new Types.ObjectId().toHexString()) }]) {
			const res = await request(app).post(`${base}/drafts`).set(auth(owner)).send(body);
			expect(res.status).toBe(400);
			expect(res.body.data.reason).toBe('invalid_input');
		}
		expect((await request(app).put(`${base}/${reviewId}/draft`).set(auth(owner)).send({ text: '' })).status).toBe(400);
		expect((await request(app).patch(`${base}/${reviewId}/report-status`).set(auth(owner)).send({ status: 'deleted' })).status).toBe(400);
		expect((await request(app).get(`${base}?rating=7`).set(auth(owner))).status).toBe(400);
	});

	it('AI without a key answers 503 ai_not_configured and spends nothing', async () => {
		const { owner, base, reviewId } = await setup();
		const res = await request(app).post(`${base}/drafts`).set(auth(owner)).send({ review_ids: [reviewId] });
		expect(res.status).toBe(503);
		expect(res.body.data.reason).toBe('ai_not_configured');
	});
});
