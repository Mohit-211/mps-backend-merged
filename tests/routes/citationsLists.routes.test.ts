import express from 'express';
import request from 'supertest';
import { Types } from 'mongoose';
import { BusinessCategory, CitationStatusLog, Client, Directory, DirectoryCategory, Location, LocationCitation } from '../../src/models';
import { createAdmin } from '../helpers/admin';
import { clearDb, createLocation, createUser, ensureOrg, startTestDb } from '../helpers/mongoose';

// Phase 16: per-location citation lists (suggestions, entries, history) and the admin work queue (offline).

jest.mock('../../src/configs/mongoConnection', () => ({ agenda: {} }));
jest.mock('node-cron', () => ({ schedule: jest.fn() }));
jest.mock('../../src/services/common/email.service', () => new Proxy({}, { get: () => jest.fn(async () => true) }));

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const app: express.Express = require('../../src/app').default;
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

const BASE = '/api/v1/admin/citations';
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
let token = '';
const api = {
	get: (path: string) => request(app).get(`${BASE}${path}`).set(bearer(token)),
	post: (path: string, body: object = {}) => request(app).post(`${BASE}${path}`).set(bearer(token)).send(body),
	patch: (path: string, body: object) => request(app).patch(`${BASE}${path}`).set(bearer(token)).send(body),
	del: (path: string, body: object = {}) => request(app).delete(`${BASE}${path}`).set(bearer(token)).send(body),
};

let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
}, 60000);
afterAll(async () => db.stop());

interface Seeded {
	ownerId: Types.ObjectId;
	locationId: string;
	dir: Record<string, string>;
}

/** A Toronto plumber, and directories: general (US+CA), home niche (CA), legal niche, ON and NB chambers, a US-only one, an inactive one. */
const seed = async (): Promise<Seeded> => {
	await clearDb();
	token = (await createAdmin('editor', 'Casey Checker')).token;
	const plumber = await BusinessCategory.create({ name: 'Plumber', slug: 'plumber' });
	const lawyer = await BusinessCategory.create({ name: 'Lawyer', slug: 'lawyer' });
	const home = await DirectoryCategory.create({ name: 'Home services', slug: 'home-services', business_category_ids: [plumber._id] });
	const legal = await DirectoryCategory.create({ name: 'Legal', slug: 'legal', business_category_ids: [lawyer._id] });
	const mk = (name: string, over: object) => Directory.create({ name, url: `https://${name.toLowerCase().replace(/\s+/g, '')}.example/`, domain: `${name.toLowerCase().replace(/\s+/g, '')}.example`, type: 'general', countries: ['US', 'CA'], ...over });
	const dirs = {
		yelp: await mk('Yelp', { authority: 93 }),
		dataaxle: await mk('Data Axle', { type: 'aggregator', authority: 80 }),
		homestars: await mk('HomeStars', { type: 'niche', countries: ['CA'], category_ids: [home._id] }),
		avvo: await mk('Avvo', { type: 'niche', category_ids: [legal._id] }),
		onchamber: await mk('Ontario Chamber', { type: 'government_chamber', countries: ['CA'], regions: ['ON'] }),
		nbchamber: await mk('NB Chamber', { type: 'government_chamber', countries: ['CA'], regions: ['NB'] }),
		usonly: await mk('US Only', { countries: ['US'] }),
		retired: await mk('Retired', { is_active: false }),
	};
	const { user } = await createUser(`owner.${Date.now()}@test.dev`);
	const location = await createLocation(user._id as Types.ObjectId);
	return { ownerId: user._id as Types.ObjectId, locationId: String(location._id), dir: Object.fromEntries(Object.entries(dirs).map(([k, d]) => [k, String(d._id)])) };
};

const namesOf = (rows: { directory: { name: string } }[]) => rows.map((r) => r.directory.name).sort();

describe('suggestions', () => {
	it('adds matching directories (country, region, category group) as not_checked; a dry run writes nothing; never re-adds a removed one', async () => {
		const s = await seed();
		const dry = await api.post(`/locations/${s.locationId}/suggest?dry_run=true`);
		expect(dry.status).toBe(200);
		expect(dry.body.data).toMatchObject({ dry_run: true, country: 'CA', region: 'ON', category_matched: true, category_groups: [{ name: 'Home services' }], business_categories: ['Plumber'] });
		expect(dry.body.data.added.map((a: { name: string }) => a.name).sort()).toEqual(['Data Axle', 'HomeStars', 'Ontario Chamber', 'Yelp']);
		expect(await LocationCitation.countDocuments({})).toBe(0);

		const real = await api.post(`/locations/${s.locationId}/suggest`);
		expect(real.body.data.added).toHaveLength(4);
		expect(await LocationCitation.countDocuments({ location_id: s.locationId, status: 'not_checked', source: 'suggested' })).toBe(4);
		const logs = await CitationStatusLog.find({}).lean();
		expect(logs).toHaveLength(4);
		expect(logs[0]).toMatchObject({ action: 'added', to: 'not_checked', by: { name: 'Casey Checker' } });
		expect((await Location.findById(s.locationId).lean())?.summary).toMatchObject({ citation_total: 4, citation_score: null, citation_coverage: 0 });

		expect((await api.post(`/locations/${s.locationId}/suggest`)).body.data).toMatchObject({ added: [], already_listed: 4 });
		const yelp = await LocationCitation.findOne({ directory_id: s.dir.yelp }).lean();
		await api.del(`/entries/${String(yelp?._id)}`, { note: 'client has no Yelp' });
		const again = await api.post(`/locations/${s.locationId}/suggest`);
		expect(again.body.data.added).toEqual([]);
		expect(await LocationCitation.countDocuments({ location_id: s.locationId, active: true })).toBe(3);
	});

	it('no category match → only directories without categories; unsupported country → nothing', async () => {
		const s = await seed();
		await Location.updateOne({ _id: s.locationId }, { $set: { business_category: 'Bakery' } });
		const res = await api.post(`/locations/${s.locationId}/suggest`);
		expect(res.body.data).toMatchObject({ category_matched: false, category_groups: [] });
		expect(res.body.data.added.map((a: { name: string }) => a.name).sort()).toEqual(['Data Axle', 'Ontario Chamber', 'Yelp']);
		await Location.updateOne({ _id: s.locationId }, { $set: { country: 'United Kingdom' } });
		expect((await api.post(`/locations/${s.locationId}/suggest?dry_run=true`)).body.data).toMatchObject({ reason: 'unsupported_country', added: [] });
		expect((await api.post('/locations/0123456789abcdef01234567/suggest')).status).toBe(404);
	});
});

describe('entries', () => {
	it('manual add (any active directory), NAP mismatch check, checks, history and the score', async () => {
		const s = await seed();
		await api.post(`/locations/${s.locationId}/suggest`);
		const added = await api.post(`/locations/${s.locationId}/entries`, { directory_ids: [s.dir.avvo, s.dir.yelp] });
		expect(added.body.data).toMatchObject({ added: [s.dir.avvo], already_listed: [s.dir.yelp], restored: [] });
		expect((await api.post(`/locations/${s.locationId}/entries`, { directory_ids: [s.dir.retired] })).body.data).toMatchObject({ reason: 'invalid_directory', inactive: [s.dir.retired] });

		const view = await api.get(`/locations/${s.locationId}`);
		expect(view.body.data.location).toMatchObject({ name: 'Maple Leaf Plumbing & Heating', nap: { name: 'Maple Leaf Plumbing & Heating', address: '100 Queen St E', phone: '4165550100', website: 'https://example.test' } });
		expect(namesOf(view.body.data.entries)).toEqual(['Avvo', 'Data Axle', 'HomeStars', 'Ontario Chamber', 'Yelp']);
		const id = (name: string) => view.body.data.entries.find((e: { directory: { name: string } }) => e.directory.name === name).id;

		// live_correct with a phone that differs → 409, unless confirmed; nap_wrong is fine.
		const wrong = await api.patch(`/entries/${id('Data Axle')}`, { status: 'live_correct', listing_url: 'https://dataaxle.example/biz/1', nap_found: { name: 'Maple Leaf Plumbing and Heating', phone: '(416) 555-0199', address: '100 Queen Street East' } });
		expect(wrong.status).toBe(409);
		expect(wrong.body.data).toEqual({ reason: 'nap_mismatch', mismatch_fields: ['phone'] });
		const napWrong = await api.patch(`/entries/${id('Data Axle')}`, { status: 'nap_wrong', listing_url: 'https://dataaxle.example/biz/1', nap_found: { name: 'Maple Leaf Plumbing and Heating', phone: '(416) 555-0199', address: '100 Queen Street East' }, note: 'old phone number' });
		expect(napWrong.body.data).toMatchObject({ changed: ['status', 'listing_url', 'nap_found'], entry: { status: 'nap_wrong', mismatch_fields: ['phone'], nap_found: { phone: '(416) 555-0199' } } });
		expect(napWrong.body.data.entry.last_checked_at).toEqual(expect.any(String));

		await api.patch(`/entries/${id('Yelp')}`, { status: 'live_correct', nap_found: { phone: '416-555-0100' } });
		await api.patch(`/entries/${id('Avvo')}`, { status: 'not_found' });
		const confirmed = await api.patch(`/entries/${id('HomeStars')}`, { status: 'live_correct', nap_found: { website: 'https://other.example' }, confirm: true });
		expect(confirmed.body.data.entry).toMatchObject({ status: 'live_correct', mismatch_fields: ['website'] });

		const notesOnly = await api.patch(`/entries/${id('Ontario Chamber')}`, { notes: 'call them' });
		expect(notesOnly.body.data.entry).toMatchObject({ notes: 'call them', last_checked_at: null, status: 'not_checked' });
		const checked = await api.patch(`/entries/${id('Yelp')}`, { checked: true });
		expect(checked.body.data.changed).toEqual([]);

		const history = await api.get(`/entries/${id('Yelp')}/history`);
		expect(history.body.data.history.map((h: { action: string }) => h.action)).toEqual(['checked', 'status_changed', 'added']);
		expect(history.body.data.history[1]).toMatchObject({ from: 'not_checked', to: 'live_correct', by: { name: 'Casey Checker' } });

		const loc = await Location.findById(s.locationId).lean();
		expect(loc?.summary).toMatchObject({ citation_total: 5, citation_counts: expect.objectContaining({ live_correct: 2, nap_wrong: 1, not_found: 1, not_checked: 1 }) });
		expect(loc?.summary?.citation_score).toEqual(expect.any(Number));
		expect(loc?.summary?.citation_grade).toMatch(/^[A-F]$/);
		expect((await api.get(`/locations/${s.locationId}`)).body.data.health).toMatchObject({ score: loc?.summary?.citation_score, total: 5, scored: 4 });
	});

	it('bulk status (NAP-mismatch entries are not marked live_correct), remove and restore', async () => {
		const s = await seed();
		await api.post(`/locations/${s.locationId}/suggest`);
		const entries = await LocationCitation.find({ location_id: s.locationId }).lean();
		const ids = entries.map((e) => String(e._id));
		const submitted = await api.post('/entries/bulk', { entry_ids: ids.slice(0, 2), status: 'submitted', note: 'sent to both' });
		expect(submitted.body.data).toMatchObject({ updated: ids.slice(0, 2), unchanged: [], skipped: [] });
		await LocationCitation.updateOne({ _id: ids[2] }, { $set: { mismatch_fields: ['phone'] } });
		const live = await api.post('/entries/bulk', { entry_ids: [...ids.slice(0, 3), '0123456789abcdef01234567'], status: 'live_correct' });
		expect(live.body.data.updated).toEqual(ids.slice(0, 2));
		expect(live.body.data.skipped).toEqual(expect.arrayContaining([{ entry_id: ids[2], reason: 'nap_mismatch' }, { entry_id: '0123456789abcdef01234567', reason: 'not_found' }]));

		const removed = await api.del(`/entries/${ids[3]}`, { note: 'duplicate of another listing' });
		expect(removed.body.data.entry.active).toBe(false);
		expect((await api.patch(`/entries/${ids[3]}`, { status: 'submitted' })).body.data).toMatchObject({ reason: 'entry_removed' });
		const view = await api.get(`/locations/${s.locationId}`);
		expect(view.body.data.entries).toHaveLength(3);
		expect(view.body.data.removed_from_list).toHaveLength(1);
		expect((await Location.findById(s.locationId).lean())?.summary?.citation_total).toBe(3);
		expect((await api.post(`/entries/${ids[3]}/restore`)).body.data.entry.active).toBe(true);
		expect((await api.get(`/entries/${ids[3]}/history`)).body.data.history.map((h: { action: string }) => h.action).slice(0, 2)).toEqual(['restored', 'removed_from_list']);
	});
});

describe('work queue', () => {
	it('unchecked (grouped by location, oldest first), stale (N days), recent; filters; deleted locations excluded', async () => {
		const s = await seed();
		const org = await ensureOrg(s.ownerId);
		const client = await Client.create({ company_name: 'Client A', organization_id: org._id });
		const second = await createLocation(s.ownerId, { name: 'Second Shop', client_id: client._id as Types.ObjectId });
		const { user: other } = await createUser(`other.${Date.now()}@test.dev`);
		const third = await createLocation(other._id as Types.ObjectId, { name: 'Other Org Shop' });
		await api.post(`/locations/${s.locationId}/suggest`);
		await LocationCitation.updateMany({ location_id: s.locationId }, { $set: { created_at: new Date(Date.now() - 5 * 86_400_000) } });
		await api.post(`/locations/${String(second._id)}/suggest`);
		await api.post(`/locations/${String(third._id)}/suggest`);

		const unchecked = await api.get('/queue/unchecked');
		expect(unchecked.body.data.total).toBe(3);
		expect(unchecked.body.data.locations[0]).toMatchObject({ location: { name: 'Maple Leaf Plumbing & Heating', organization: { id: String(org._id) } }, unchecked: 4, active_entries: 4 });
		expect((await api.get(`/queue/unchecked?organization_id=${String(org._id)}`)).body.data.total).toBe(2);
		const byClient = await api.get(`/queue/unchecked?client_id=${String(client._id)}`);
		expect(byClient.body.data.locations.map((l: { location: { name: string; client: { name: string } } }) => [l.location.name, l.location.client.name])).toEqual([['Second Shop', 'Client A']]);
		expect((await api.get(`/queue/unchecked?type=aggregator`)).body.data.locations.every((l: { unchecked: number }) => l.unchecked === 1)).toBe(true);

		// Stale: checked 100 days ago (default 90) vs yesterday.
		const mine = await LocationCitation.find({ location_id: s.locationId }).lean();
		await LocationCitation.updateOne({ _id: mine[0]._id }, { $set: { status: 'live_correct', last_checked_at: new Date(Date.now() - 100 * 86_400_000) } });
		await LocationCitation.updateOne({ _id: mine[1]._id }, { $set: { status: 'submitted', last_checked_at: new Date(Date.now() - 86_400_000) } });
		const stale = await api.get('/queue/stale');
		expect(stale.body.data).toMatchObject({ days: 90, total: 1 });
		expect(stale.body.data.entries[0]).toMatchObject({ id: String(mine[0]._id), days_since_check: 100, location: { name: 'Maple Leaf Plumbing & Heating' } });
		expect((await api.get('/queue/stale?days=1')).body.data.total).toBe(2);
		expect((await api.get('/queue/stale?days=1&status=submitted')).body.data.total).toBe(1);

		const recent = await api.get('/queue/recent');
		expect(recent.body.data.total).toBe(12);
		expect(recent.body.data.changes[0]).toMatchObject({ action: 'added', by: { name: 'Casey Checker' }, directory: { name: expect.any(String) }, location: { name: expect.any(String) } });
		expect((await api.get(`/queue/recent?directory_id=${s.dir.yelp}`)).body.data.total).toBe(3);

		await Location.updateOne({ _id: third._id }, { $set: { deleted_at: new Date() } });
		expect((await api.get('/queue/unchecked')).body.data.total).toBe(2);
		expect((await api.get('/queue/recent')).body.data.total).toBe(8);
		expect((await api.get(`/locations/${String(third._id)}`)).status).toBe(404);
	});
});
