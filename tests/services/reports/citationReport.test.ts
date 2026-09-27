import fs from 'fs';
import os from 'os';
import path from 'path';
import { Types } from 'mongoose';
import { Directory, ILocation, Location, LocationCitation, Report, ReportSchedule, ReportSnapshot } from '../../../src/models';
import { entriesService } from '../../../src/services/citations/entries.service';
import { suggestForLocation } from '../../../src/services/citations/suggest';
import { renderSharePage } from '../../../src/services/reports/render/html';
import { createReportService } from '../../../src/services/reports/report.service';
import { scheduleService } from '../../../src/services/reports/schedule.service';
import { createStorage } from '../../../src/services/reports/storage';
import { SnapshotData } from '../../../src/services/reports/types';
import { clearDb, createLocation, createUser, ensureOrg, startTestDb } from '../../helpers/mongoose';

// Phase 16: the Citation Report and the Citations part of the Full report (snapshot → blocks → PDF / HTML),
// and a monthly schedule of type `citation`.

jest.mock('../../../src/configs/mongoConnection', () => ({ agenda: {} }));
jest.mock('../../../src/configs/agenda', () => ({ getAgenda: () => ({ schedule: jest.fn(async () => ({})), cancel: jest.fn(async () => 0) }), stopAgenda: jest.fn() }));

const ADMIN = { id: '0123456789abcdef0123abcd', name: 'Casey Checker' };
let db: { stop: () => Promise<void> };
let root: string;
beforeAll(async () => {
	db = await startTestDb();
}, 60000);
afterAll(async () => db.stop());
beforeEach(async () => {
	await clearDb();
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'mps-citation-report-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const withCitations = async () => {
	const { user } = await createUser('owner@test.dev');
	await ensureOrg(user._id);
	const location = await createLocation(user._id as Types.ObjectId);
	for (const [name, type, authority] of [['Yelp', 'general', 93], ['Data Axle', 'aggregator', 80], ['Foursquare', 'general', null]] as const) {
		await Directory.create({ name, url: `https://${name.replace(' ', '').toLowerCase()}.example/`, domain: `${name.replace(' ', '').toLowerCase()}.example`, type, countries: ['CA'], authority });
	}
	await suggestForLocation(location._id, { actor: ADMIN });
	const id = async (name: string) => String((await LocationCitation.findOne({ directory_id: (await Directory.findOne({ name }))?._id }))?._id);
	await entriesService.updateEntry(await id('Yelp'), { status: 'live_correct' }, ADMIN);
	await entriesService.updateEntry(await id('Data Axle'), { status: 'nap_wrong', nap_found: { phone: '416-555-0199' }, note: 'internal note' }, ADMIN);
	return { user, location: (await Location.findById(location._id)) as ILocation };
};

describe('Citation Report', () => {
	it('snapshot + PDF + HTML: score, NAP issues, table, changes; no admin names', async () => {
		const { user, location } = await withCitations();
		const reports = createReportService({ storage: createStorage(root), enqueue: async () => undefined });
		const created = await reports.createFor(location, { type: 'citation' }, { trigger: 'manual', created_by: user._id as Types.ObjectId });
		expect(created.sections).toEqual(['score', 'table', 'nap_issues', 'changes']);
		const out = await reports.generate(created.report_id);
		expect(out.status).toBe('ready');
		expect(out.pages).toBeGreaterThan(0);

		const snapshot = await ReportSnapshot.findOne({ report_id: created.report_id }).lean();
		const data = snapshot?.data as SnapshotData;
		expect(data.citation).toMatchObject({
			available: true,
			range: '28d',
			score: { total: 3, counts: expect.objectContaining({ live_correct: 1, nap_wrong: 1, not_checked: 1 }) },
			nap_issues: { expected: { phone: '4165550100' }, rows: [{ directory: 'Data Axle', field: 'phone', found: '416-555-0199', expected: '4165550100' }] },
		});
		const c = data.citation as { table: { directory: string; status: string }[]; changes: { action: string }[] };
		expect(c.table.map((r) => r.status)).toEqual(['nap_wrong', 'not_checked', 'live_correct']);
		expect(c.changes.map((x) => x.action).sort()).toEqual(['added', 'added', 'added', 'status_changed', 'status_changed']);

		const report = await Report.findById(created.report_id).lean();
		const doc = reports.documentOf(report as never, snapshot as never);
		expect(doc).toMatchObject({ title: 'Citation Report', attribution: null });
		expect(doc.period).toMatch(/^Citations as of /);
		const html = renderSharePage(doc, '/r/x/pdf');
		expect(html).toContain('Citation Health');
		expect(html).toContain('Data Axle');
		expect(html).toContain('Wrong NAP');
		expect(JSON.stringify(snapshot)).not.toContain('Casey Checker');
		expect(JSON.stringify(snapshot)).not.toContain('internal note');
	});

	it('a location without citations: 400 no_citations_yet; the Full report still includes a Citations part when it has some', async () => {
		const { user } = await createUser('bare@test.dev');
		const bare = await createLocation(user._id as Types.ObjectId);
		const reports = createReportService({ storage: createStorage(root), enqueue: async () => undefined });
		await expect(reports.createFor(bare, { type: 'citation' }, { trigger: 'manual', created_by: user._id as Types.ObjectId })).rejects.toMatchObject({ data: { reason: 'no_citations_yet' } });
		await expect(reports.createFor(bare, { type: 'full' }, { trigger: 'manual', created_by: user._id as Types.ObjectId })).rejects.toMatchObject({ data: { reason: 'no_data' } });

		const { location } = await withCitations();
		const full = await reports.createFor(location, { type: 'full' }, { trigger: 'manual', created_by: user._id as Types.ObjectId });
		expect(full.sections).toEqual(['rank_tracker', 'gbp_audit', 'competitor_analysis', 'citation']);
		expect((await reports.generate(full.report_id)).status).toBe('ready');
		const snapshot = await ReportSnapshot.findOne({ report_id: full.report_id }).lean();
		const data = snapshot?.data as SnapshotData;
		expect(data.citation).toMatchObject({ available: true });
		expect(data.rank_tracker).toMatchObject({ available: false, reason: 'no_rank_run' });
		const doc = reports.documentOf((await Report.findById(full.report_id).lean()) as never, snapshot as never);
		expect(doc.blocks.filter((b) => b.kind === 'heading' && b.level === 1).map((b) => (b as { text: string }).text)).toEqual(['Rankings', 'Google Business Profile', 'Competitors', 'Citations']);
	});

	it('a monthly schedule of type citation creates one report per automatic refresh cycle', async () => {
		const { user, location } = await withCitations();
		const org = await ensureOrg(user._id);
		const schedule = await ReportSchedule.create({ organization_id: org._id, scope: 'location', location_id: location._id, type: 'citation', sections: [], range: '90d', recipients: ['boss@x.test'], created_by: user._id });
		await Location.updateOne({ _id: location._id }, { $set: { 'refresh.last_auto_refresh_at': new Date('2026-09-15T07:00:00Z') } });
		expect(await scheduleService.dispatchForLocation(location._id)).toBe(1);
		expect(await Report.findOne({ schedule_id: schedule._id }).lean()).toMatchObject({ type: 'citation', trigger: 'schedule', params: { range: '90d' } });
	});
});
