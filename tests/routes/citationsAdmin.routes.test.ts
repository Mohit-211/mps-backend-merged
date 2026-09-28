import express from 'express';
import request from 'supertest';
import { BusinessCategory, Directory, DirectoryCategory } from '../../src/models';
import { createAdmin } from '../helpers/admin';
import { clearDb, createUser, startTestDb } from '../helpers/mongoose';

// Phase 16: the citation admin endpoints for directories, categories and CSV (offline).

jest.mock('../../src/configs/mongoConnection', () => ({ agenda: {} }));
jest.mock('node-cron', () => ({ schedule: jest.fn() }));
jest.mock('../../src/services/common/email.service', () => new Proxy({}, { get: () => jest.fn(async () => true) }));

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const app: express.Express = require('../../src/app').default;
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

const BASE = '/api/v1/admin/citations';
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let db: { stop: () => Promise<void> };
let token = '';
let plumberId = '';
let electricianId = '';
beforeAll(async () => {
	db = await startTestDb();
}, 60000);
afterAll(async () => db.stop());
beforeEach(async () => {
	await clearDb();
	token = (await createAdmin('editor')).token;
	const [p, e] = await BusinessCategory.create([
		{ name: 'Plumber', slug: 'plumber' },
		{ name: 'Electrician', slug: 'electrician' },
	]);
	plumberId = String(p._id);
	electricianId = String(e._id);
});

const api = {
	get: (path: string) => request(app).get(`${BASE}${path}`).set(bearer(token)),
	post: (path: string, body: object) => request(app).post(`${BASE}${path}`).set(bearer(token)).send(body),
	patch: (path: string, body: object) => request(app).patch(`${BASE}${path}`).set(bearer(token)).send(body),
	del: (path: string) => request(app).delete(`${BASE}${path}`).set(bearer(token)),
	csv: (text: string, dryRun = false) => request(app).post(`${BASE}/directories/import${dryRun ? '?dry_run=true' : ''}`).set(bearer(token)).set('Content-Type', 'text/csv').send(text),
};

const homeCategory = async () => (await api.post('/categories', { name: 'Home services', business_category_ids: [plumberId, electricianId] })).body.data;

describe('directory categories', () => {
	it('CRUD with GBP business-category mapping; delete refused while in use', async () => {
		const search = await api.get('/business-categories?q=plumb');
		expect(search.body.data).toEqual([{ id: plumberId, name: 'Plumber' }]);
		const created = await api.post('/categories', { name: 'Home services', business_category_ids: [plumberId] });
		expect(created.status).toBe(201);
		expect(created.body.data).toMatchObject({ name: 'Home services', slug: 'home-services', business_categories: [{ id: plumberId, name: 'Plumber' }], directory_count: 0 });
		expect((await api.post('/categories', { name: 'Home Services' })).body.data).toMatchObject({ reason: 'slug_taken' });
		expect((await api.post('/categories', { name: 'X', business_category_ids: ['0123456789abcdef01234567'] })).body.data).toMatchObject({ reason: 'unknown_business_category' });
		const id = created.body.data.id;
		expect((await api.patch(`/categories/${id}`, { business_category_ids: [plumberId, electricianId] })).body.data.business_categories).toHaveLength(2);
		await api.post('/directories', { name: 'Angi', url: 'https://www.angi.com/', type: 'niche', countries: ['US'], category_ids: [id] });
		const inUse = await api.del(`/categories/${id}`);
		expect(inUse.status).toBe(409);
		expect(inUse.body.data).toMatchObject({ reason: 'in_use', directory_count: 1 });
		expect((await api.get('/categories')).body.data[0].directory_count).toBe(1);
	});
});

describe('directories', () => {
	it('create, list with filters, detail, update, deactivate; validation and duplicate domains', async () => {
		const cat = await homeCategory();
		const yelp = await api.post('/directories', { name: 'Yelp', url: 'https://www.yelp.com/', type: 'general', countries: ['US', 'CA'], authority: 93 });
		expect(yelp.status).toBe(201);
		expect(yelp.body.data).toMatchObject({ domain: 'yelp.com', categories: [], countries: ['US', 'CA'], is_active: true });
		await api.post('/directories', { name: 'HomeStars', url: 'https://homestars.com', type: 'niche', countries: ['CA'], category_ids: [cat.id] });
		await api.post('/directories', { name: 'Texas Chamber', url: 'https://tx-chamber.example.org', type: 'government_chamber', countries: ['US'], regions: ['tx'] });

		const dup = await api.post('/directories', { name: 'Yelp again', url: 'http://yelp.com/biz', type: 'general', countries: ['US'] });
		expect(dup.status).toBe(409);
		expect(dup.body.data).toMatchObject({ reason: 'domain_taken', domain: 'yelp.com' });
		const nicheNoCat = await api.post('/directories', { name: 'Avvo', url: 'https://avvo.com', type: 'niche', countries: ['US'] });
		expect(nicheNoCat.body.data).toMatchObject({ reason: 'invalid_directory', problems: [{ field: 'categories' }] });
		const badRegion = await api.post('/directories', { name: 'X', url: 'https://x.example', type: 'general', countries: ['US'], regions: ['ON'] });
		expect(badRegion.body.data.problems[0].field).toBe('regions');
		expect((await api.post('/directories', { name: 'X', url: 'ftp://x.example', type: 'general', countries: ['US'] })).status).toBe(400);

		expect((await api.get('/directories')).body.data).toMatchObject({ total: 3, page: 1 });
		expect((await api.get('/directories?country=CA')).body.data.directories.map((d: { name: string }) => d.name)).toEqual(['HomeStars', 'Yelp']);
		expect((await api.get(`/directories?category_id=${cat.id}`)).body.data.total).toBe(1);
		expect((await api.get('/directories?q=chamber&type=government_chamber')).body.data.directories[0].regions).toEqual(['TX']);

		const id = yelp.body.data.id;
		expect((await api.get(`/directories/${id}`)).body.data).toMatchObject({ name: 'Yelp', used_by_locations: 0 });
		expect((await api.patch(`/directories/${id}`, { authority: 90, notes: 'check the Canadian site too' })).body.data).toMatchObject({ authority: 90, notes: 'check the Canadian site too' });
		expect((await api.patch(`/directories/${id}`, { type: 'niche' })).body.data).toMatchObject({ reason: 'invalid_directory' });
		const off = await api.del(`/directories/${id}`);
		expect(off.body.data.is_active).toBe(false);
		expect(await Directory.countDocuments({})).toBe(3);
		expect((await api.get('/directories?active=true')).body.data.total).toBe(2);
		expect((await api.get('/directories/0123456789abcdef01234567')).status).toBe(404);
		expect((await api.get('/directories/not-an-id')).status).toBe(400);
	});

	it('a user token is not an admin token', async () => {
		const { token: userToken } = await createUser('u@test.dev');
		expect((await request(app).get(`${BASE}/directories`).set(bearer(userToken))).status).toBe(401);
	});
});

describe('CSV import / export', () => {
	const header = 'name,url,type,countries,categories,regions,authority,notes,active';

	it('dry run counts without writing; import creates; a second import is unchanged; updates by domain', async () => {
		await homeCategory();
		const csv = [header, 'Angi,https://www.angi.com/,niche,US,home-services,,85,,true', 'Yelp,https://www.yelp.com/,general,US|CA,,,93,,', 'Texas Chamber,https://tx.example.org/,government_chamber,US,,TX,,"Region, limited",true'].join('\n');
		const dry = await api.csv(csv, true);
		expect(dry.status).toBe(200);
		expect(dry.body.data).toMatchObject({ dry_run: true, applied: false, rows: 3, created: 3, updated: 0, unchanged: 0, errors: [] });
		expect(await Directory.countDocuments({})).toBe(0);

		const real = await api.csv(csv);
		expect(real.body.data).toMatchObject({ applied: true, created: 3 });
		const chamber = await Directory.findOne({ domain: 'tx.example.org' }).lean();
		expect(chamber).toMatchObject({ regions: ['TX'], notes: 'Region, limited', authority: null, is_active: true });
		expect((await api.csv(csv)).body.data).toMatchObject({ applied: false, created: 0, updated: 0, unchanged: 3 });

		const changed = await api.csv([header, 'Yelp,https://www.yelp.com/,general,US,,,95,,false'].join('\n'));
		expect(changed.body.data).toMatchObject({ applied: true, updated: 1 });
		expect(await Directory.findOne({ domain: 'yelp.com' }).lean()).toMatchObject({ countries: ['US'], authority: 95, is_active: false });
		expect(await Directory.countDocuments({})).toBe(3); // directories missing from the file are kept
	});

	it('all-or-nothing: any row error → 422 with every error, nothing applied', async () => {
		await homeCategory();
		const csv = [
			header,
			'Angi,https://www.angi.com/,niche,US,home-services,,85,,true',
			'Avvo,https://www.avvo.com/,niche,US,lawyers,,,,',
			'Yelp,https://yelp.com/,general,US,,,,,',
			'Yelp CA,https://www.yelp.com/ca,general,CA,,,,,',
			'Bad,notaurl,weird,UK,,ZZ,abc,,maybe',
			'Chamber,https://c.example,government_chamber,US,,ON,,,',
		].join('\n');
		const res = await api.csv(csv);
		expect(res.status).toBe(422);
		expect(res.body.data.applied).toBe(false);
		const fields = res.body.data.errors.map((e: { row: number; field: string }) => `${e.row}:${e.field}`);
		expect(fields).toEqual(expect.arrayContaining(['3:categories', '5:url', '6:type', '6:countries', '6:authority', '6:active', '7:regions']));
		expect(await Directory.countDocuments({})).toBe(0);
	});

	it('header and file errors', async () => {
		expect((await api.csv('name,url,type\nA,https://a.example,general')).body.data).toMatchObject({ reason: 'invalid_csv_header', missing: ['countries'] });
		expect((await api.csv(`${header},extra\nA,https://a.example,general,US,,,,,,x`)).body.data).toMatchObject({ reason: 'invalid_csv_header', unknown: ['extra'] });
		expect((await api.csv(header)).body.data).toMatchObject({ reason: 'empty_csv' });
		expect((await api.csv(`${header}\n"unclosed,https://a.example,general,US,,,,,`)).body.data).toMatchObject({ reason: 'invalid_csv' });
		const empty = await request(app).post(`${BASE}/directories/import`).set(bearer(token)).send({});
		expect(empty.status).toBe(400);
	});

	it('export: BOM, header, pipes, slugs; formula cells neutralised; export → import is unchanged', async () => {
		const cat = await homeCategory();
		await DirectoryCategory.create({ name: 'Legal', slug: 'legal' });
		await api.post('/directories', { name: 'Angi', url: 'https://www.angi.com/', type: 'niche', countries: ['US'], category_ids: [cat.id], authority: 85 });
		await api.post('/directories', { name: 'Yelp', url: 'https://www.yelp.com/', type: 'general', countries: ['US', 'CA'], notes: 'Plain note, with comma' });
		await api.post('/directories', { name: '=HYPERLINK("x")', url: 'https://evil.example/', type: 'general', countries: ['US'], notes: '@SUM(1)' });
		const res = await api.get('/directories/export');
		expect(res.status).toBe(200);
		expect(res.headers['content-type']).toContain('text/csv');
		expect(res.headers['content-disposition']).toMatch(/attachment; filename="citation-directories-\d{4}-\d{2}-\d{2}\.csv"/);
		const text = res.text;
		expect(text.charCodeAt(0)).toBe(0xfeff);
		const lines = text.slice(1).trim().split('\n');
		expect(lines[0]).toBe(header);
		expect(lines).toContain('Angi,https://www.angi.com/,niche,US,home-services,,85,,true');
		expect(lines).toContain('Yelp,https://www.yelp.com/,general,US|CA,,,,"Plain note, with comma",true');
		expect(lines.find((l) => l.includes('evil'))).toBe(`"'=HYPERLINK(""x"")",https://evil.example/,general,US,,,,'@SUM(1),true`);

		await Directory.deleteOne({ domain: 'evil.example' });
		const clean = [header, ...lines.slice(1).filter((l) => !l.includes('evil'))].join('\n');
		expect((await api.csv(clean)).body.data).toMatchObject({ rows: 2, unchanged: 2, created: 0, updated: 0 });
	});
});
