import fs from 'fs';
import os from 'os';
import path from 'path';
import mongoose, { Types } from 'mongoose';
import { Organization, Report, ReportSnapshot } from '../../../src/models';
import { migrateBranding } from '../../../src/services/reports/migrateBranding';
import { createReportService } from '../../../src/services/reports/report.service';
import { createStorage } from '../../../src/services/reports/storage';
import { clearDb, createLocation, createUser, ensureOrg, startTestDb } from '../../helpers/mongoose';

// Phase 12: report retention (report-retention job) and the migrate:branding migration.

jest.mock('../../../src/configs/mongoConnection', () => ({ agenda: {} }));

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
let db: { stop: () => Promise<void> };
let root: string;
beforeAll(async () => {
	db = await startTestDb();
}, 60000);
afterAll(async () => db.stop());
beforeEach(async () => {
	await clearDb();
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'mps-reports-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('retention', () => {
	it('deletes the PDF and snapshot of reports past their expiry and marks them expired', async () => {
		const storage = createStorage(root);
		const orgId = new Types.ObjectId();
		const mk = async (expires: Date) => {
			const r = await Report.create({ organization_id: orgId, location_id: new Types.ObjectId(), type: 'rank_tracker', status: 'ready', active: false, created_by: new Types.ObjectId(), expires_at: expires, pdf: { file: 'x.pdf', bytes: 1, pages: 1, sha256: 'x' } });
			await storage.write(storage.pdfPath(String(orgId), String(r._id)), Buffer.from('%PDF'));
			await ReportSnapshot.create({ report_id: r._id, type: 'rank_tracker', location: { name: 'x' }, branding: { name: 'x' }, data: {} });
			return r;
		};
		const old = await mk(new Date(Date.now() - 1000));
		const fresh = await mk(new Date(Date.now() + 86_400_000));
		expect(await createReportService({ storage }).expireOld()).toBe(1);
		expect(await Report.findById(old._id).lean()).toMatchObject({ status: 'expired', pdf: null });
		expect(await storage.read(storage.pdfPath(String(orgId), String(old._id)))).toBeNull();
		expect(await ReportSnapshot.exists({ report_id: old._id })).toBeNull();
		expect(await storage.read(storage.pdfPath(String(orgId), String(fresh._id)))).not.toBeNull();
		expect(await createReportService({ storage }).expireOld()).toBe(0);
	});
});

describe('migrate:branding', () => {
	it('copies the primary legacy profile of an agency (logo into private storage); never overwrites; skips businesses', async () => {
		const storage = createStorage(root);
		const uploads = path.join(root, 'uploads');
		fs.mkdirSync(uploads);
		fs.writeFileSync(path.join(uploads, 'logo-1.png'), PNG);
		const { user } = await createUser('agency@test.dev');
		const org = await ensureOrg(user._id, 'agency');
		const loc = await createLocation(user._id as Types.ObjectId);
		const legacy = (over: Record<string, unknown>) =>
			mongoose.connection.collection('whitelabel_profiles').insertOne({ name: 'Old', header: 'h', footer: 'f', color: 'default', is_active: true, is_primary: false, created_at: new Date('2025-01-01'), ...over });
		await legacy({ location_id: loc._id, name: 'Acme Old', header: 'Call 555-0100', footer: 'Acme Ltd', color: 'red', file_name: 'logo-1.png', is_primary: true });
		await legacy({ created_by: user._id, name: 'Newer, not primary' });
		const { user: biz } = await createUser('biz@test.dev');
		await ensureOrg(biz._id, 'business');

		const dry = await migrateBranding({ uploadsDir: uploads, storage, dryRun: true });
		expect(dry).toEqual([{ organization_id: String(org._id), organization: org.name, result: 'migrated', logo: 'copied' }]);
		expect((await Organization.findById(org._id).lean())?.branding).toBeNull();

		await migrateBranding({ uploadsDir: uploads, storage });
		const branding = (await Organization.findById(org._id).lean())?.branding;
		expect(branding).toMatchObject({ agency_name: 'Acme Old', contact_text: 'Call 555-0100', footer_text: 'Acme Ltd', primary_color: '#b91c1c', hide_mypageseo: false, logo: { file: 'logo.png', mime: 'image/png', bytes: PNG.length } });
		expect(await storage.read(storage.logoPath(String(org._id), 'png'))).toEqual(PNG);

		await Organization.updateOne({ _id: org._id }, { $set: { 'branding.agency_name': 'Edited' } });
		expect((await migrateBranding({ uploadsDir: uploads, storage }))[0].result).toBe('has_branding');
		expect((await Organization.findById(org._id).lean())?.branding?.agency_name).toBe('Edited');
	});
});
