import express from 'express';
import request from 'supertest';
import { Types } from 'mongoose';
import { createAdmin } from '../helpers/admin';
import { addMember, clearDb, createUser, ensureOrg, startTestDb } from '../helpers/mongoose';

// Phase 13b: support tickets with threads (customer side and team side).

jest.mock('../../src/configs/mongoConnection', () => ({ agenda: {} }));
jest.mock('../../src/configs/agenda', () => ({ getAgenda: () => ({ schedule: jest.fn(), cancel: jest.fn(async () => 0) }), stopAgenda: jest.fn() }));
jest.mock('../../src/services/common/email.service', () => new Proxy({}, { get: () => jest.fn(async () => true) }));

/* oxlint-disable typescript/no-var-requires */
const app: express.Express = require('../../src/app').default;
/* oxlint-enable typescript/no-var-requires */

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
}, 60000);
afterAll(async () => db.stop());
beforeEach(clearDb);

describe('support tickets', () => {
	it('a thread between the customer and the team; internal notes stay internal; statuses follow the replies', async () => {
		const { user, token } = await createUser('owner@shop.test');
		const org = await ensureOrg(user._id);
		const { token: adminToken, id: adminId } = await createAdmin('editor', 'Sam Support');

		let res = await request(app).post('/api/v1/support/tickets').set(bearer(token)).send({ subject: 'Rank run failed', category: 'technical', message: 'The run shows failed.' });
		expect(res.status).toBe(201);
		const id = res.body.data.id as string;
		expect(res.body.data).toMatchObject({ number: 'TCK-000001', status: 'open', messages: 1, thread: [{ body: 'The run shows failed.' }] });

		res = await request(app).get('/api/v1/admin/support/tickets/counts').set(bearer(adminToken));
		expect(res.body.data).toMatchObject({ open: 1, unassigned_open: 1 });
		res = await request(app).post(`/api/v1/admin/support/tickets/${id}/messages`).set(bearer(adminToken)).send({ message: 'Looks like a quota issue', internal: true });
		expect(res.body.data).toMatchObject({ status: 'open', assigned_to: { id: adminId } });
		res = await request(app).post(`/api/v1/admin/support/tickets/${id}/messages`).set(bearer(adminToken)).send({ message: 'We re-ran it; please check.' });
		expect(res.body.data).toMatchObject({ status: 'waiting_on_customer', last_message_by: 'team', messages: 3 });

		res = await request(app).get(`/api/v1/support/tickets/${id}`).set(bearer(token));
		expect(res.body.data.thread.map((m: { body: string }) => m.body)).toEqual(['The run shows failed.', 'We re-ran it; please check.']);
		expect(res.body.data.thread[1].author).toEqual({ kind: 'team', name: 'MyPageSEO team' });

		res = await request(app).post(`/api/v1/support/tickets/${id}/messages`).set(bearer(token)).send({ message: 'Works now, thanks' });
		expect(res.body.data.status).toBe('open');
		res = await request(app).patch(`/api/v1/admin/support/tickets/${id}`).set(bearer(adminToken)).send({ status: 'resolved', priority: 'low' });
		expect(res.body.data).toMatchObject({ status: 'resolved', priority: 'low' });
		res = await request(app).post(`/api/v1/support/tickets/${id}/close`).set(bearer(token));
		expect(res.body.data.status).toBe('closed');
		expect((await request(app).post(`/api/v1/support/tickets/${id}/messages`).set(bearer(token)).send({ message: 'x' })).body.data.reason).toBe('ticket_closed');

		res = await request(app).get('/api/v1/admin/support/tickets?q=TCK-0000').set(bearer(adminToken));
		expect(res.body.data).toMatchObject({ total: 1, tickets: [{ organization: { id: String(org._id) }, created_by: { email: 'owner@shop.test' } }] });
		expect((await request(app).get(`/api/v1/admin/support/tickets/${id}`).set(bearer(adminToken))).body.data.thread).toHaveLength(4);
	});

	it('organization isolation; a client_user sees only its own tickets', async () => {
		const { user, token } = await createUser('owner@agency.test');
		const org = await ensureOrg(user._id, 'agency');
		const cu = await createUser('client@agency.test');
		await addMember(org._id as Types.ObjectId, cu.user._id, 'client_user');
		const stranger = await createUser('x@other.test');
		await ensureOrg(stranger.user._id);

		const mine = await request(app).post('/api/v1/support/tickets').set(bearer(token)).send({ subject: 'Owner question', message: 'Hello' });
		await request(app).post('/api/v1/support/tickets').set(bearer(cu.token)).send({ subject: 'Client question', message: 'Hi' });
		expect((await request(app).get('/api/v1/support/tickets').set(bearer(token))).body.data.total).toBe(2);
		expect((await request(app).get('/api/v1/support/tickets').set(bearer(cu.token))).body.data.tickets.map((t: { subject: string }) => t.subject)).toEqual(['Client question']);
		expect((await request(app).get(`/api/v1/support/tickets/${mine.body.data.id}`).set(bearer(cu.token))).status).toBe(404);
		expect((await request(app).get(`/api/v1/support/tickets/${mine.body.data.id}`).set(bearer(stranger.token))).status).toBe(404);
		expect((await request(app).post('/api/v1/support/tickets').set(bearer(token)).send({ subject: 'x' })).status).toBe(400);
	});
});
