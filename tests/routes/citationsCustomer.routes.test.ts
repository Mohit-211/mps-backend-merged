import express from 'express';
import request from 'supertest';
import { Types } from 'mongoose';
import { BusinessCategory, Client, Directory, DirectoryCategory, LocationCitation, Organization } from '../../src/models';
import { entriesService } from '../../src/services/citations/entries.service';
import { suggestForLocation } from '../../src/services/citations/suggest';
import { addMember, clearDb, createLocation, createUser, ensureOrg, startTestDb } from '../helpers/mongoose';

// Phase 16: citations for organization users (read-only), the dashboard block and recommended actions,
// and the organization access rules (AUDIT S15 for the citation routes).

jest.mock('../../src/configs/mongoConnection', () => ({ agenda: {} }));
jest.mock('node-cron', () => ({ schedule: jest.fn() }));
jest.mock('../../src/services/common/email.service', () => new Proxy({}, { get: () => jest.fn(async () => true) }));

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const app: express.Express = require('../../src/app').default;
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const ADMIN = { id: '0123456789abcdef0123abcd', name: 'Casey Checker' };

let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
}, 60000);
afterAll(async () => db.stop());
beforeEach(async () => clearDb());

/** An agency with one client's location, a suggested list and a few recorded checks. */
const seed = async () => {
	const { user: owner, token } = await createUser('owner@agency.test');
	const org = await ensureOrg(owner._id, 'agency');
	const client = await Client.create({ company_name: 'Maple Leaf', organization_id: org._id });
	const location = await createLocation(owner._id as Types.ObjectId, { client_id: client._id as Types.ObjectId });
	const plumber = await BusinessCategory.create({ name: 'Plumber', slug: 'plumber' });
	const home = await DirectoryCategory.create({ name: 'Home services', slug: 'home-services', business_category_ids: [plumber._id] });
	const mk = (name: string, over: object = {}) => Directory.create({ name, url: `https://${name.toLowerCase()}.example/`, domain: `${name.toLowerCase()}.example`, type: 'general', countries: ['CA'], ...over });
	await mk('Yelp', { authority: 93 });
	await mk('DataAxle', { type: 'aggregator', authority: 80 });
	await mk('HomeStars', { type: 'niche', category_ids: [home._id] });
	await mk('Foursquare');
	await suggestForLocation(location._id, { actor: ADMIN });
	const idOf = async (name: string) => String((await LocationCitation.findOne({ directory_id: (await Directory.findOne({ name }))?._id }))?._id);
	await entriesService.updateEntry(await idOf('Yelp'), { status: 'live_correct', listing_url: 'https://yelp.example/biz/maple' }, ADMIN);
	await entriesService.updateEntry(await idOf('DataAxle'), { status: 'nap_wrong', nap_found: { phone: '416-555-0199', name: 'Maple Leaf Plumbing & Heating' }, note: 'internal: owner said old number' }, ADMIN);
	await entriesService.updateEntry(await idOf('HomeStars'), { status: 'not_found' }, ADMIN);
	await entriesService.updateEntry(await idOf('Foursquare'), { notes: 'internal-only note: call Monday' }, ADMIN);
	return { owner, token, org, client, location };
};

describe('GET /locations/:locationId/citations', () => {
	it('dashboard + table for the organization: score, counts, NAP issues, problems first; no admin names or notes', async () => {
		const { token, location } = await seed();
		const res = await request(app).get(`/api/v1/locations/${String(location._id)}/citations`).set(bearer(token));
		expect(res.status).toBe(200);
		const data = res.body.data;
		expect(data).toMatchObject({ available: true, health: { total: 4 }, counts: { live_correct: 1, nap_wrong: 1, not_found: 1, not_checked: 1 } });
		expect(data.health.score).toEqual(expect.any(Number));
		expect(data.health.grade).toMatch(/^[A-F]$/);
		expect(data.citations.map((c: { status: string }) => c.status)).toEqual(['nap_wrong', 'not_found', 'not_checked', 'live_correct']);
		expect(data.citations[0]).toMatchObject({ directory: { name: 'DataAxle', type: 'aggregator' }, nap_issues: [{ field: 'phone', found: '416-555-0199', expected: '4165550100' }] });
		expect(data.citations[3]).toMatchObject({ directory: { name: 'Yelp' }, listing_url: 'https://yelp.example/biz/maple', last_checked_at: expect.any(String) });
		expect(data.recent_changes[0]).toMatchObject({ by: 'MyPageSEO team', directory: { name: expect.any(String) } });
		expect(data.recent_changes.some((c: { changed_fields: string[] }) => c.changed_fields.includes('notes'))).toBe(false);
		const text = JSON.stringify(res.body);
		for (const secret of ['Casey Checker', ADMIN.id, 'internal', 'checked_by', 'notes"']) expect(text).not.toContain(secret);

		const filtered = await request(app).get(`/api/v1/locations/${String(location._id)}/citations?status=nap_wrong`).set(bearer(token));
		expect(filtered.body.data.citations).toHaveLength(1);
		expect((await request(app).get(`/api/v1/locations/${String(location._id)}/citations?status=bogus`).set(bearer(token))).status).toBe(400);

		const changes = await request(app).get(`/api/v1/locations/${String(location._id)}/citations/changes?limit=3`).set(bearer(token));
		// 4 "added" + 3 checks; the notes-only edit is hidden.
		expect(changes.body.data).toMatchObject({ page: 1, limit: 3, total: 7 });
		expect(changes.body.data.changes).toHaveLength(3);
	});

	it('an empty list says so', async () => {
		const { user, token } = await createUser('lone@test.dev');
		const location = await createLocation(user._id as Types.ObjectId);
		const res = await request(app).get(`/api/v1/locations/${String(location._id)}/citations`).set(bearer(token));
		expect(res.body.data).toEqual({ available: false, reason: 'no_citations_yet' });
	});

	it('organization access: another organization → 404; a client_user only for its clients; no writes', async () => {
		const { org, client, location } = await seed();
		const url = `/api/v1/locations/${String(location._id)}/citations`;
		expect((await request(app).get(url)).status).toBe(401);
		const { user: stranger, token: strangerToken } = await createUser('stranger@test.dev');
		await ensureOrg(stranger._id);
		expect((await request(app).get(url).set(bearer(strangerToken))).status).toBe(404);
		expect((await request(app).get(`${url}/changes`).set(bearer(strangerToken))).status).toBe(404);
		const other = await Client.create({ company_name: 'Other', organization_id: org._id });
		const { user: cuOther, token: cuOtherToken } = await createUser('cu-other@test.dev');
		await addMember(org._id, cuOther._id, 'client_user', [other._id as Types.ObjectId]);
		expect((await request(app).get(url).set(bearer(cuOtherToken))).status).toBe(404);
		const { user: cu, token: cuToken } = await createUser('cu@test.dev');
		await addMember(org._id, cu._id, 'client_user', [client._id as Types.ObjectId]);
		expect((await request(app).get(url).set(bearer(cuToken))).status).toBe(200);
		expect((await request(app).post(url).set(bearer(cuToken)).send({})).status).toBe(404);
		expect(await Organization.countDocuments({})).toBeGreaterThan(1);
	});
});

describe('dashboard', () => {
	it('agency dashboard: citations block, table column and the NAP / not-listed actions', async () => {
		const { token, location } = await seed();
		const res = await request(app).get('/api/v1/dashboard').set(bearer(token));
		expect(res.status).toBe(200);
		const d = res.body.data;
		expect(d.type).toBe('agency');
		expect(d.citations).toMatchObject({ available: true, listings: 4, live_correct: 1, nap_wrong: 1, not_found: 1, not_checked: 1 });
		expect(d.portfolio.avg_citation_score).toBe(d.citations.score);
		expect(d.table.rows[0].citations).toMatchObject({ score: d.citations.score, nap_wrong: 1 });
		const ids = d.recommended_actions.map((a: { id: string }) => a.id);
		expect(ids).toEqual(expect.arrayContaining(['citations:nap_wrong', 'citations:not_found']));
		const nap = d.recommended_actions.find((a: { id: string }) => a.id === 'citations:nap_wrong');
		expect(nap).toMatchObject({ source: 'citations', location_id: String(location._id), title: '1 listing shows the wrong name, address or phone' });
	});

	it('business dashboard: no citations yet', async () => {
		const { user, token } = await createUser('biz@test.dev');
		await createLocation(user._id as Types.ObjectId);
		const d = (await request(app).get('/api/v1/dashboard').set(bearer(token))).body.data;
		expect(d.type).toBe('business');
		expect(d.citations).toEqual({ available: false, reason: 'no_citations_yet' });
		expect(d.locations[0]).toMatchObject({ citation_score: null });
	});
});
