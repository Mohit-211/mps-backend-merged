import express from 'express';
import request from 'supertest';
import { createAdmin } from '../helpers/admin';
import { clearDb, startTestDb } from '../helpers/mongoose';

// Phase 13b: the read-only admin role list (the guard matrix covers 401 / 403).

jest.mock('../../src/configs/mongoConnection', () => ({ agenda: {} }));
jest.mock('../../src/configs/agenda', () => ({ getAgenda: () => ({ schedule: jest.fn(), cancel: jest.fn() }), stopAgenda: jest.fn() }));

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const app: express.Express = require('../../src/app').default;
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
}, 60000);
afterAll(async () => db.stop());
beforeEach(clearDb);

describe('GET /admin/roles', () => {
	it('lists the three fixed roles with their permissions; the old CRUD is gone', async () => {
		const { token } = await createAdmin('superAdmin');
		const res = await request(app).get('/api/v1/admin/roles').set({ Authorization: `Bearer ${token}` });
		expect(res.status).toBe(200);
		expect(res.body.data.map((r: { key: string }) => r.key)).toEqual(['superAdmin', 'admin', 'editor']);
		expect(res.body.data[0].permissions).toContain('admins.manage');
		expect(res.body.data[2].permissions).toEqual(['content.manage', 'citations.view', 'citations.manage']);
		expect((await request(app).post('/api/v1/roles').set({ Authorization: `Bearer ${token}` }).send({})).status).toBe(404);
	});
});
