import express from 'express';
import request from 'supertest';
import { SalesAudit } from '../../src/models';
import { createAdmin } from '../helpers/admin';
import { clearDb, startTestDb } from '../helpers/mongoose';

// Phase 19: the sales audit routes with a real sales-representative session (the guard matrix in
// adminGuards.routes.test.ts covers 401 / 403 for every role). No Places key in tests.

jest.mock('../../src/configs/mongoConnection', () => ({ agenda: {} }));
jest.mock('../../src/configs/agenda', () => ({ getAgenda: () => ({ schedule: jest.fn(), cancel: jest.fn() }), stopAgenda: jest.fn() }));

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const app: express.Express = require('../../src/app').default;
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
}, 60000);
afterAll(async () => db.stop());
beforeEach(clearDb);

const doneAudit = (createdBy: string) =>
	SalesAudit.create({
		created_by: createdBy,
		status: 'done',
		keyword: 'plumber',
		business: {
			place_id: 'ChIJselfselfselfselfself1',
			lat: 45.96,
			lng: -66.64,
			country: 'CA',
			region: 'ca',
			name: 'Maple Leaf Plumbing',
			address: '1 King St',
			rating: 4.5,
			user_rating_count: 30,
			category: 'Plumber',
			has_hours: true,
			website: null,
			phone: null,
			has_editorial_summary: false,
			photo_count: 4,
			business_status: 'OPERATIONAL',
			score: { score: 60, grade: 'C', flag: null, parts: [] },
			checklist: [{ id: 'website', label: 'Website', state: 'missing', detail: 'Not listed' }],
		},
		grid: { size: 3, radius_km: 5, spacing_km: 5 },
		result: {
			cells: Array.from({ length: 9 }, (_, i) => ({ row: Math.floor(i / 3), col: i % 3, lat: 0, lng: 0, rank: i === 4 ? 2 : null, status: i === 4 ? 'ok' : 'not_found' })),
			summary: { center_rank: 2, center_status: 'ok', avg_rank: 27.8, found_rate: 0.11, top3_rate: 0.11, points: 9, failed_points: 0 },
			higher: [{ rank: 1, name: 'Rival', address: '2 King St', is_self: false }],
			competitors: [],
		},
		expires_at: new Date(Date.now() + 3600 * 1000),
		created_at: new Date(),
	});

describe('/staff/audits', () => {
	it('validates input and answers 503 without a Places key', async () => {
		const { token } = await createAdmin('sales');
		expect((await request(app).post('/api/v1/staff/audits').set(bearer(token)).send({ place_id: 'ChIJx' })).status).toBe(400);
		const res = await request(app).post('/api/v1/staff/audits').set(bearer(token)).send({ place_id: 'ChIJselfselfselfselfself1', keyword: 'plumber' });
		expect(res.status).toBe(503);
		expect(res.body.data).toMatchObject({ reason: 'places_not_configured' });
		expect((await request(app).get('/api/v1/staff/audits/places/autocomplete?input=ma&session=bad').set(bearer(token))).status).toBe(400);
	});

	it('shows, exports and closes the caller’s own audit only', async () => {
		const sales = await createAdmin('sales');
		const other = await createAdmin('sales', 'other rep');
		const audit = await doneAudit(sales.id);
		const url = `/api/v1/staff/audits/${String(audit._id)}`;

		const view = await request(app).get(url).set(bearer(sales.token));
		expect(view.status).toBe(200);
		expect(view.body.data).toMatchObject({ status: 'done', keyword: 'plumber', attribution: { text: 'Google Maps' } });
		expect((await request(app).get('/api/v1/staff/audits').set(bearer(sales.token))).body.data.audits).toHaveLength(1);
		expect((await request(app).get(url).set(bearer(other.token))).status).toBe(404);

		const pdf = await request(app).get(`${url}/pdf`).set(bearer(sales.token)).buffer(true).parse((res, cb) => {
			const chunks: Buffer[] = [];
			res.on('data', (c: Buffer) => chunks.push(c));
			res.on('end', () => cb(null, Buffer.concat(chunks)));
		});
		expect(pdf.status).toBe(200);
		expect(pdf.headers['content-type']).toBe('application/pdf');
		expect(pdf.headers['content-disposition']).toMatch(/^attachment; filename="audit-maple-leaf-plumbing-\d{4}-\d{2}-\d{2}\.pdf"$/);
		expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

		expect((await request(app).delete(url).set(bearer(other.token))).status).toBe(404);
		expect((await request(app).delete(url).set(bearer(sales.token))).body.data).toEqual({ deleted: true, id: String(audit._id) });
		expect(await SalesAudit.countDocuments()).toBe(0);
	});

	it('is closed to the editor role', async () => {
		const { token } = await createAdmin('editor');
		const res = await request(app).get('/api/v1/staff/audits').set(bearer(token));
		expect(res.status).toBe(403);
		expect(res.body.data).toMatchObject({ reason: 'forbidden', permission: 'audits.run' });
	});
});
