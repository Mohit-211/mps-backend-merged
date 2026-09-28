import fs from 'fs';
import os from 'os';
import path from 'path';
import { Types } from 'mongoose';
import { Report, ReportSnapshot } from '../../../src/models';
import { createReportService } from '../../../src/services/reports/report.service';
import { createStorage } from '../../../src/services/reports/storage';
import { clearDb, startTestDb } from '../../helpers/mongoose';

// Phase 12: report retention (report-retention job).

jest.mock('../../../src/configs/mongoConnection', () => ({ agenda: {} }));

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
