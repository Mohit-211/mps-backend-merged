import express from 'express';
import request from 'supertest';
import { Types } from 'mongoose';
import { queryTypesArr } from '../../src/configs/constantTypes';
import { createDemoDetailsClient, writeDemoGbpData } from '../../src/gbp/demo/demoGbp';
import { generateGbpReport } from '../../src/gbp/report/generate';
import { Client, GbpReport, Location, RankRun, Report, ReportSchedule, ReportShare, ReportSnapshot, UserGBP } from '../../src/models';
import { DEMO_PLACE_IDS } from '../../src/ranking/demo/demoPlaces';
import { apiErrorHandler, getQueryParams } from '../../src/utils';
import { addMember, clearDb, createLocation, createUser, ensureOrg, keywordsOf, startTestDb } from '../helpers/mongoose';

// Phase 12: reports, share links, schedules and branding over HTTP (in-memory MongoDB, no network).

jest.mock('../../src/configs/mongoConnection', () => ({ agenda: {} }));
const scheduleMock = jest.fn<Promise<object>, unknown[]>(async () => ({}));
jest.mock('../../src/configs/agenda', () => ({ getAgenda: () => ({ schedule: scheduleMock, cancel: jest.fn() }), stopAgenda: jest.fn() }));
const mailMock = jest.fn<Promise<boolean>, unknown[]>(async () => true);
jest.mock('../../src/services/common/email.service', () => ({ sendReportEmail: (...args: unknown[]) => mailMock(...args) }));

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const reportsRoute = require('../../src/routes/v1/common/reports.route').default;
const schedulesRoute = require('../../src/routes/v1/common/reportSchedules.route').default;
const organizationRoute = require('../../src/routes/v1/common/organization.route').default;
const shareRoute = require('../../src/routes/share.route').default;
const { reportService } = require('../../src/services/reports/report.service');
const { scheduleService } = require('../../src/services/reports/schedule.service');
const { requestScheduleDispatch, sendScheduledReport } = require('../../src/services/reports/dispatch');
const { createReportEmailService } = require('../../src/services/reports/reportEmail.service');
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(getQueryParams(queryTypesArr));
app.use('/api/v1/reports', reportsRoute);
app.use('/api/v1/report-schedules', schedulesRoute);
app.use('/api/v1/organization', organizationRoute);
app.use('/r', shareRoute);
app.use(apiErrorHandler);

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const NOW = new Date();
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
	await Promise.all([Report.syncIndexes(), ReportShare.syncIndexes(), ReportSnapshot.syncIndexes(), GbpReport.syncIndexes(), UserGBP.syncIndexes()]);
}, 60000);
afterAll(async () => db.stop());
beforeEach(async () => {
	await clearDb();
	scheduleMock.mockClear();
	mailMock.mockClear();
});

const insertRun = async (locationId: Types.ObjectId, avg = 5) => {
	const points = [1, 2, 4, 8, 12, 25, 70, 3, 5].map((r, i) => ({ row: Math.floor(i / 3), col: i % 3, lat: 0, lng: 0, byTarget: { self: r > 60 ? { rank: null, status: 'not_found' } : { rank: r, status: 'ok' } } }));
	const { insertedId } = await RankRun.collection.insertOne({
		location_id: locationId,
		status: 'done',
		active: false,
		run_at: NOW,
		finished_at: NOW,
		config: { grid_size: 3, spacing_km: 1 },
		targets: [{ key: 'self', place_id: DEMO_PLACE_IDS.self }, { key: 'competitor_1', place_id: DEMO_PLACE_IDS.competitor_1 }],
		overall: { self: { overallAvgRank: avg, change: 1.2 }, competitor_1: { overallAvgRank: 3, change: null } },
		tracker: [{ keyword: 'plumber', cells: [], summary: { self: { avgRank: avg, foundRate: 1, top3Rate: 0.4, change: 1.2, changeLabel: 'improved' }, competitor_1: { avgRank: 3, foundRate: 1, top3Rate: 0.6 } } }],
		grid: [{ keyword: 'plumber', size: 3, spacing_km: 1, points, summary: { self: { avgRank: 14.6, foundRate: 0.89, top3Rate: 0.33 } } }],
		mapList: [{ keyword: 'plumber', results: [{ rank: 1, place_id: DEMO_PLACE_IDS.competitor_1, is_self: false }, { rank: 3, place_id: DEMO_PLACE_IDS.self, is_self: true }] }],
	});
	return insertedId;
};

/** An owner with one location that has a rank run (and optionally GBP data + the GBP report). */
const setup = async (opts: { bound?: boolean; type?: 'business' | 'agency'; email?: string } = {}) => {
	const { user, token } = await createUser(opts.email ?? `o${Math.random()}@test.dev`);
	const org = await ensureOrg(user._id, opts.type ?? 'business');
	const location = await createLocation(user._id as Types.ObjectId, { place_id: DEMO_PLACE_IDS.self, tracking: { keywords: keywordsOf('plumber') } });
	const runId = await insertRun(location._id as Types.ObjectId);
	if (opts.bound) await writeDemoGbpData({ _id: location._id as Types.ObjectId }, user._id as Types.ObjectId, NOW);
	await generateGbpReport(String(location._id), 'rank_run', { places: createDemoDetailsClient(), now: () => NOW, v4Enabled: false });
	return { user, token, org, location, id: String(location._id), runId };
};

const createAndGenerate = async (token: string, body: Record<string, unknown>) => {
	const res = await request(app).post('/api/v1/reports').set(auth(token)).send(body);
	expect(res.status).toBe(202);
	const result = await reportService.generate(res.body.data.report_id);
	expect(result.status).toBe('ready');
	return res.body.data.report_id as string;
};

describe('POST /reports + generation', () => {
	it('queues, generates a frozen snapshot + PDF, lists, views and downloads', async () => {
		const { token, id } = await setup({ bound: true });
		const res = await request(app).post('/api/v1/reports').set(auth(token)).send({ location_id: id, type: 'rank_tracker' });
		expect(res.status).toBe(202);
		expect(res.body.data).toMatchObject({ status: 'queued', type: 'rank_tracker', existing: false, sections: ['summary', 'keywords', 'history', 'grid', 'movers', 'map_ranking', 'keyword_groups'] });
		expect(scheduleMock).toHaveBeenCalledWith(expect.any(Date), 'report-generate', { report_id: res.body.data.report_id });
		// Phase 17: the row says which run (and when) the report shows.
		expect(res.body.data).toMatchObject({ run_id: expect.any(String), run_at: expect.any(String) });
		const again = await request(app).post('/api/v1/reports').set(auth(token)).send({ location_id: id, type: 'rank_tracker' });
		expect(again.body.data).toMatchObject({ existing: true, report_id: res.body.data.report_id });

		const reportId = res.body.data.report_id;
		expect((await request(app).get(`/api/v1/reports/${reportId}/pdf`).set(auth(token))).status).toBe(409);
		await reportService.generate(reportId);
		expect(await reportService.generate(reportId)).toEqual({ status: 'skipped' }); // a retried job does nothing

		const view = (await request(app).get(`/api/v1/reports/${reportId}`).set(auth(token))).body.data;
		expect(view.report).toMatchObject({ status: 'ready', pdf: { pages: expect.any(Number) }, location: { name: 'Maple Leaf Plumbing & Heating' } });
		expect(view.snapshot.data.rank_tracker.summary).toMatchObject({ overall_avg_rank: 5, change: 1.2 });
		expect(view.document.blocks.some((b: { kind: string }) => b.kind === 'heatmap')).toBe(true);

		const pdf = await request(app).get(`/api/v1/reports/${reportId}/pdf`).set(auth(token)).buffer(true).parse((r, cb) => {
			const chunks: Buffer[] = [];
			r.on('data', (c: Buffer) => chunks.push(c));
			r.on('end', () => cb(null, Buffer.concat(chunks)));
		});
		expect(pdf.status).toBe(200);
		expect(pdf.headers['content-type']).toBe('application/pdf');
		expect(pdf.headers['content-disposition']).toMatch(/^attachment; filename="maple-leaf-plumbing-heating-rank-tracker-\d{4}-\d{2}-\d{2}\.pdf"$/);
		expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

		// Frozen: later data changes don't alter the stored report.
		await RankRun.updateMany({ location_id: new Types.ObjectId(id) }, { $set: { 'overall.self.overallAvgRank': 40 } });
		const after = (await request(app).get(`/api/v1/reports/${reportId}`).set(auth(token))).body.data;
		expect(after.snapshot.data.rank_tracker.summary.overall_avg_rank).toBe(5);

		const list = (await request(app).get('/api/v1/reports?type=rank_tracker').set(auth(token))).body.data;
		expect(list).toMatchObject({ total: 1, reports: [{ report_id: reportId, status: 'ready' }] });
	});

	it('GBP audit and full: v4 sections unavailable, never sample data; unbound → 400 gbp_not_connected', async () => {
		const bound = await setup({ bound: true });
		const auditId = await createAndGenerate(bound.token, { location_id: bound.id, type: 'gbp_audit', range: '90d' });
		const audit = (await request(app).get(`/api/v1/reports/${auditId}`).set(auth(bound.token))).body.data.snapshot.data.gbp_audit;
		expect(audit).toMatchObject({ range: '90d', score: { score: expect.any(Number) }, performance: { days: 90 } });
		expect(audit.reviews_media_posts.reviews).toEqual({ available: false, reason: 'v4_access_pending' });

		const unbound = await setup();
		const res = await request(app).post('/api/v1/reports').set(auth(unbound.token)).send({ location_id: unbound.id, type: 'gbp_audit' });
		expect(res.status).toBe(400);
		expect(res.body.data).toMatchObject({ reason: 'gbp_not_connected' });
		const fullId = await createAndGenerate(unbound.token, { location_id: unbound.id, type: 'full' });
		const full = (await request(app).get(`/api/v1/reports/${fullId}`).set(auth(unbound.token))).body.data;
		expect(full.snapshot.data.gbp_audit).toEqual({ available: false, reason: 'gbp_not_connected' });
		expect(full.snapshot.data.competitor_analysis.available).toBe(true);
		// Phase 16: Citations (here: none tracked yet); 2026-10-02: Reputation, the fifth part.
		expect(full.document.blocks.filter((b: { kind: string }) => b.kind === 'heading' && (b as unknown as { level: number }).level === 1)).toHaveLength(5);
		expect(full.snapshot.data.citation).toEqual({ available: false, reason: 'no_citations_yet' });
	});

	it('validation: unknown section 400, no rank run 400, other organization 404, bad type 400', async () => {
		const { token, id, user } = await setup();
		expect((await request(app).post('/api/v1/reports').set(auth(token)).send({ location_id: id, type: 'rank_tracker', sections: ['score'] })).body.data).toMatchObject({ reason: 'invalid_section' });
		expect((await request(app).post('/api/v1/reports').set(auth(token)).send({ location_id: id, type: 'weekly' })).status).toBe(400);
		const other = await createLocation(user._id as Types.ObjectId, { place_id: 'ChIJnoRunPlace00000000001' });
		const noRun = await request(app).post('/api/v1/reports').set(auth(token)).send({ location_id: String(other._id), type: 'rank_tracker' });
		expect(noRun.body.data).toMatchObject({ reason: 'no_rank_run' });
		const { token: stranger } = await createUser('stranger@test.dev');
		await ensureOrg((await createUser('s2@test.dev')).user._id);
		const strangerOrg = await setup({ email: 'third@test.dev' });
		expect((await request(app).post('/api/v1/reports').set(auth(strangerOrg.token)).send({ location_id: id, type: 'rank_tracker' })).status).toBe(404);
		expect((await request(app).get('/api/v1/reports').set(auth(stranger))).status).toBe(403); // no organization
	});

	it('archive hides it from the library (status=archived lists it); a failed generation records the reason', async () => {
		const { token, id } = await setup();
		const reportId = await createAndGenerate(token, { location_id: id, type: 'competitor_analysis' });
		expect((await request(app).delete(`/api/v1/reports/${reportId}`).set(auth(token))).body.data).toEqual({ archived: true, report_id: reportId });
		expect((await request(app).get('/api/v1/reports').set(auth(token))).body.data.total).toBe(0);
		expect((await request(app).get('/api/v1/reports?status=archived').set(auth(token))).body.data.total).toBe(1);

		const res = await request(app).post('/api/v1/reports').set(auth(token)).send({ location_id: id, type: 'rank_tracker' });
		await Location.updateOne({ _id: id }, { $set: { is_active: false } });
		await Location.collection.deleteOne({ _id: new Types.ObjectId(id) });
		expect(await reportService.generate(res.body.data.report_id)).toEqual({ status: 'failed' });
		expect(await Report.findById(res.body.data.report_id).lean()).toMatchObject({ status: 'failed', active: false, failure_reason: 'location not found', pdf: null });
	});
});

describe('2026-10-02: reputation report, deleted locations, live rows', () => {
	it('a reputation report is built from stored reviews and insights only', async () => {
		const { token, id } = await setup({ bound: true });
		const reportId = await createAndGenerate(token, { location_id: id, type: 'reputation' });
		const doc = (await request(app).get(`/api/v1/reports/${reportId}`).set(auth(token))).body.data;
		expect(doc.snapshot.data.reputation).toMatchObject({
			available: true,
			summary: { total: expect.any(Number), reply_rate: expect.any(Number) },
			distribution: [{ stars: 5 }, { stars: 4 }, { stars: 3 }, { stars: 2 }, { stars: 1 }],
			needs_attention: expect.any(Array),
			replies_sent: { this_month: expect.any(Number) },
			insights: { available: false, reason: 'no_insights' },
		});
		expect(doc.document.title).toBe('Reputation Report');
		const unbound = await setup({});
		const res = await request(app).post('/api/v1/reports').set(auth(unbound.token)).send({ location_id: unbound.id, type: 'reputation' });
		expect(res.status).toBe(400);
		expect(res.body.data.reason).toBe('no_reviews');
	});

	it('reports of a deleted location keep its name, marked deleted; include_deleted=false hides them', async () => {
		const { token, id, location } = await setup({ bound: true });
		await createAndGenerate(token, { location_id: id, type: 'gbp_audit' });
		await Location.updateOne({ _id: location._id }, { $set: { is_active: false, deleted_at: new Date() } });
		const list = await request(app).get('/api/v1/reports').set(auth(token));
		expect(list.body.data.reports[0].location).toEqual({ location_id: id, name: location.name, deleted: true });
		expect((await request(app).get('/api/v1/reports?include_deleted=false').set(auth(token))).body.data.reports).toEqual([]);
	});

	it('the list adds live rows for the stored GBP report (no PDF)', async () => {
		const { token, id } = await setup({ bound: true });
		const res = await request(app).get('/api/v1/reports').set(auth(token));
		expect(res.body.data.live).toEqual([expect.objectContaining({ kind: 'live', type: 'gbp_report', location: { location_id: id, name: expect.any(String), deleted: false }, link: { page: 'gbp_report', location_id: id } })]);
		expect((await request(app).get('/api/v1/reports?type=rank_tracker').set(auth(token))).body.data.live).toEqual([]);
		expect((await request(app).get('/api/v1/reports?page=2').set(auth(token))).body.data.live).toEqual([]);
	});
});

describe('client_user access', () => {
	it('sees only its clients’ reports and can’t create, email, share or archive', async () => {
		const agency = await setup({ type: 'agency' });
		const client = await Client.create({ company_name: 'Maple Group', organization_id: agency.org._id });
		const other = await Client.create({ company_name: 'Other', organization_id: agency.org._id });
		await Location.updateOne({ _id: agency.id }, { $set: { client_id: client._id } });
		const mine = await createAndGenerate(agency.token, { location_id: agency.id, type: 'rank_tracker' });
		const loc2 = await createLocation(agency.user._id as Types.ObjectId, { place_id: 'ChIJotherClientPlace00001', client_id: other._id as Types.ObjectId });
		await insertRun(loc2._id as Types.ObjectId);
		const theirs = await createAndGenerate(agency.token, { location_id: String(loc2._id), type: 'rank_tracker' });

		const { user: cu, token: cuToken } = await createUser('cu@test.dev');
		await addMember(agency.org._id, cu._id, 'client_user', [client._id as Types.ObjectId]);
		const list = (await request(app).get('/api/v1/reports').set(auth(cuToken))).body.data;
		expect(list.reports.map((r: { report_id: string }) => r.report_id)).toEqual([mine]);
		expect(list.reports[0].client).toEqual({ client_id: String(client._id), name: 'Maple Group' });
		expect((await request(app).get(`/api/v1/reports/${mine}/pdf`).set(auth(cuToken))).status).toBe(200);
		expect((await request(app).get(`/api/v1/reports/${theirs}`).set(auth(cuToken))).status).toBe(404);
		for (const call of [
			request(app).post('/api/v1/reports').send({ location_id: agency.id, type: 'rank_tracker' }),
			request(app).post(`/api/v1/reports/${mine}/email`).send({ recipients: ['a@x.test'] }),
			request(app).post(`/api/v1/reports/${mine}/share`).send({}),
			request(app).delete(`/api/v1/reports/${mine}`),
		]) {
			const res = await call.set(auth(cuToken));
			expect(res.status).toBe(403);
			expect(res.body.data).toMatchObject({ reason: 'read_only' });
		}
	});
});

describe('POST /reports/:id/email', () => {
	it('attaches the PDF with the branding sender; 20 per hour per organization', async () => {
		const { token, id } = await setup({ type: 'agency' });
		await request(app).put('/api/v1/organization/branding').set(auth(token)).send({ agency_name: 'Acme SEO', email_reply_to: 'team@acme.test' });
		const reportId = await createAndGenerate(token, { location_id: id, type: 'rank_tracker' });
		const res = await request(app).post(`/api/v1/reports/${reportId}/email`).set(auth(token)).send({ recipients: ['A@x.test', 'a@x.test', 'b@y.test'], message: 'Monthly numbers' });
		expect(res.status).toBe(200);
		expect(res.body.data).toEqual({ sent: true, recipients: 2, delivery: 'attachment' });
		const mail = mailMock.mock.calls[0][0] as { to: string[]; senderName: string; replyTo: string; attachment: { filename: string; content: Buffer }; html: string };
		expect(mail).toMatchObject({ to: ['a@x.test', 'b@y.test'], senderName: 'Acme SEO via MyPageSEO', replyTo: 'team@acme.test' });
		expect(mail.attachment.content.subarray(0, 5).toString()).toBe('%PDF-');
		expect(mail.html).toContain('Monthly numbers');
		expect((await request(app).post(`/api/v1/reports/${reportId}/email`).set(auth(token)).send({ recipients: ['not-an-email'] })).status).toBe(400);
		for (let i = 0; i < 19; i++) await request(app).post(`/api/v1/reports/${reportId}/email`).set(auth(token)).send({ recipients: ['a@x.test'] });
		const limited = await request(app).post(`/api/v1/reports/${reportId}/email`).set(auth(token)).send({ recipients: ['a@x.test'] });
		expect(limited.status).toBe(429);
	});

	it('above the attachment limit a 30-day share link is emailed', async () => {
		const { token, id } = await setup();
		const reportId = await createAndGenerate(token, { location_id: id, type: 'rank_tracker' });
		const report = await Report.findById(reportId);
		const mailer = jest.fn(async () => true);
		const big = await createReportEmailService({ mailer, maxAttachmentBytes: 10 }).send(report, ['a@x.test'], { sentBy: null, rateLimited: false });
		expect(big).toEqual({ sent: true, recipients: 1, delivery: 'link' });
		const call = (mailer.mock.calls[0] as unknown as [{ attachment: unknown; text: string }])[0];
		expect(call.attachment).toBeNull();
		expect(call.text).toMatch(/\/r\/[A-Za-z0-9_-]{43}/);
		expect(await ReportShare.findOne({ report_id: reportId }).lean()).toMatchObject({ purpose: 'email_link', expires_at: expect.any(Date) });
	});
});

describe('share links and the public /r page', () => {
	it('token shown once and hashed; HTML is noindex with no ids; revoke, expiry and archive give 404', async () => {
		const { token, id } = await setup();
		const reportId = await createAndGenerate(token, { location_id: id, type: 'rank_tracker' });
		const created = await request(app).post(`/api/v1/reports/${reportId}/share`).set(auth(token)).send({ expires_in_days: 7 });
		expect(created.status).toBe(201);
		const shareToken = new URL(created.body.data.url).pathname.split('/')[2];
		const stored = await ReportShare.findById(created.body.data.share_id).lean();
		expect(stored?.token_hash).not.toContain(shareToken);

		const page = await request(app).get(`/r/${shareToken}`);
		expect(page.status).toBe(200);
		expect(page.headers['x-robots-tag']).toContain('noindex');
		expect(page.headers['content-security-policy']).toContain("default-src 'none'");
		expect(page.text).toContain('Rank Tracker Report');
		expect(page.text).not.toMatch(/[a-f0-9]{24}/);
		expect(page.text).not.toContain(DEMO_PLACE_IDS.self);
		const pdf = await request(app).get(`/r/${shareToken}/pdf`);
		expect(pdf.status).toBe(200);
		expect(pdf.headers['content-type']).toBe('application/pdf');
		const shares = (await request(app).get(`/api/v1/reports/${reportId}/shares`).set(auth(token))).body.data;
		expect(shares[0]).toMatchObject({ views: 1, active: true });

		expect((await request(app).get('/r/not-a-real-token-at-all-xxxxxxxx')).status).toBe(404);
		await request(app).delete(`/api/v1/reports/${reportId}/shares/${created.body.data.share_id}`).set(auth(token));
		expect((await request(app).get(`/r/${shareToken}`)).status).toBe(404);

		const second = await request(app).post(`/api/v1/reports/${reportId}/share`).set(auth(token)).send({});
		const t2 = new URL(second.body.data.url).pathname.split('/')[2];
		expect(second.body.data.expires_at).toBeNull();
		await ReportShare.updateOne({ _id: second.body.data.share_id }, { $set: { expires_at: new Date(Date.now() - 1000) } });
		expect((await request(app).get(`/r/${t2}`)).status).toBe(404);

		const third = await request(app).post(`/api/v1/reports/${reportId}/share`).set(auth(token)).send({});
		const t3 = new URL(third.body.data.url).pathname.split('/')[2];
		await request(app).delete(`/api/v1/reports/${reportId}`).set(auth(token));
		expect((await request(app).get(`/r/${t3}`)).status).toBe(404);
		expect((await request(app).post(`/api/v1/reports/${reportId}/share`).set(auth(token)).send({})).status).toBe(409);
	});

	it('rate-limited per IP', async () => {
		let last = 0;
		for (let i = 0; i < 61; i++) last = (await request(app).get('/r/some-unknown-token-value-000000')).status;
		expect(last).toBe(429);
	});
});

describe('report schedules', () => {
	it('location schedule: one report per monthly cycle, emailed once ready; manual refreshes and paused schedules do nothing', async () => {
		const { token, id } = await setup();
		await Location.updateOne({ _id: id }, { $set: { 'refresh.next_refresh_at': new Date('2026-10-15T07:00:00Z') } });
		const created = await request(app).post('/api/v1/report-schedules').set(auth(token)).send({ scope: 'location', location_id: id, type: 'rank_tracker', recipients: ['Boss@x.test'] });
		expect(created.status).toBe(201);
		expect(created.body.data).toMatchObject({ scope: 'location', recipients: ['boss@x.test'], status: 'active', next_expected: '2026-10-15T07:00:00.000Z', last_sent_at: null });
		const scheduleId = created.body.data.schedule_id;

		expect(await scheduleService.dispatchForLocation(id)).toBe(0); // no automatic refresh yet
		const cycle = new Date('2026-09-15T07:00:00Z');
		await Location.updateOne({ _id: id }, { $set: { 'refresh.last_auto_refresh_at': cycle } });
		expect(await scheduleService.dispatchForLocation(id)).toBe(1);
		expect(await scheduleService.dispatchForLocation(id)).toBe(0); // same cycle
		const report = await Report.findOne({ schedule_id: scheduleId }).lean();
		expect(report).toMatchObject({ trigger: 'schedule', type: 'rank_tracker' });

		scheduleMock.mockClear();
		await reportService.generate(String(report?._id));
		expect(scheduleMock).toHaveBeenCalledWith(expect.any(Date), 'report-email', { report_id: String(report?._id), schedule_id: scheduleId });
		expect(await sendScheduledReport(String(report?._id), scheduleId)).toBe('sent');
		expect(mailMock).toHaveBeenCalledTimes(1);
		const after = (await request(app).get(`/api/v1/report-schedules/${scheduleId}`).set(auth(token))).body.data;
		expect(after).toMatchObject({ last_error: null, last_report_id: String(report?._id) });
		expect(after.last_sent_at).not.toBeNull();

		await request(app).patch(`/api/v1/report-schedules/${scheduleId}`).set(auth(token)).send({ status: 'paused' });
		await Location.updateOne({ _id: id }, { $set: { 'refresh.last_auto_refresh_at': new Date('2026-10-15T07:00:00Z') } });
		expect(await scheduleService.dispatchForLocation(id)).toBe(0);
		expect((await request(app).get('/api/v1/report-schedules?status=paused').set(auth(token))).body.data).toHaveLength(1);
		expect((await request(app).delete(`/api/v1/report-schedules/${scheduleId}`).set(auth(token))).body.data).toEqual({ deleted: true, schedule_id: scheduleId });
	});

	it('client schedule covers the client’s locations; failures are recorded; the hook only queues when a schedule applies', async () => {
		const agency = await setup({ type: 'agency' });
		const client = await Client.create({ company_name: 'Maple Group', organization_id: agency.org._id });
		await Location.updateOne({ _id: agency.id }, { $set: { client_id: client._id, 'refresh.last_auto_refresh_at': new Date('2026-09-15T07:00:00Z') } });
		const enqueue = jest.fn(async () => undefined);
		await requestScheduleDispatch(agency.id, enqueue);
		expect(enqueue).not.toHaveBeenCalled();

		const created = await request(app).post('/api/v1/report-schedules').set(auth(agency.token)).send({ scope: 'client', client_id: String(client._id), type: 'gbp_audit', recipients: ['c@x.test'] });
		expect(created.status).toBe(201);
		expect(created.body.data.locations).toEqual([{ location_id: agency.id, name: 'Maple Leaf Plumbing & Heating' }]);
		await requestScheduleDispatch(agency.id, enqueue);
		expect(enqueue).toHaveBeenCalledWith({ location_id: agency.id });

		expect(await scheduleService.dispatchForLocation(agency.id)).toBe(0); // gbp_audit on an unbound location
		const s = await ReportSchedule.findById(created.body.data.schedule_id).lean();
		expect(s?.last_error).toContain('Connect the Google Business Profile');
	});

	it('validation: manual_only 400, client scope for a business 403, gbp_audit without GBP 400, too many recipients 400', async () => {
		const { token, id } = await setup();
		const post = (body: Record<string, unknown>) => request(app).post('/api/v1/report-schedules').set(auth(token)).send(body);
		expect((await post({ scope: 'location', location_id: id, type: 'gbp_audit', recipients: ['a@x.test'] })).body.data).toMatchObject({ reason: 'gbp_not_connected' });
		expect((await post({ scope: 'client', client_id: id, type: 'rank_tracker', recipients: ['a@x.test'] })).body.data).toMatchObject({ reason: 'agency_only' });
		expect((await post({ scope: 'location', location_id: id, type: 'rank_tracker', recipients: Array.from({ length: 11 }, (_, i) => `a${i}@x.test`) })).status).toBe(400);
		expect((await post({ scope: 'location', client_id: id, type: 'rank_tracker', recipients: ['a@x.test'] })).status).toBe(400);
		await Location.updateOne({ _id: id }, { $set: { 'tracking.frequency': 'manual_only' } });
		expect((await post({ scope: 'location', location_id: id, type: 'rank_tracker', recipients: ['a@x.test'] })).body.data).toMatchObject({ reason: 'manual_only' });
	});
});

describe('organization branding', () => {
	it('agency owner sets colours and a private logo, frozen into reports; business and members are refused', async () => {
		const agency = await setup({ type: 'agency' });
		const put = await request(app).put('/api/v1/organization/branding').set(auth(agency.token)).send({ agency_name: 'Acme SEO', primary_color: '#AA0000', hide_mypageseo: true, footer_text: '' });
		expect(put.status).toBe(200);
		expect(put.body.data).toMatchObject({ white_label: true, name: 'Acme SEO', primary_color: '#aa0000', hide_mypageseo: true, footer_text: null, logo: null });
		expect((await request(app).put('/api/v1/organization/branding').set(auth(agency.token)).send({ primary_color: 'red' })).status).toBe(400);

		const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');
		expect((await request(app).put('/api/v1/organization/branding/logo').set(auth(agency.token)).send({ data: `data:image/png;base64,${svg}` })).body.data).toMatchObject({ reason: 'logo_type' });
		const big = Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.alloc(530 * 1024)]).toString('base64');
		expect((await request(app).put('/api/v1/organization/branding/logo').set(auth(agency.token)).send({ data: big })).status).toBe(400);
		const logo = await request(app).put('/api/v1/organization/branding/logo').set(auth(agency.token)).send({ data: `data:image/png;base64,${PNG}` });
		expect(logo.body.data.logo).toMatchObject({ mime: 'image/png', url: '/api/v1/organization/branding/logo' });
		const got = await request(app).get('/api/v1/organization/branding/logo').set(auth(agency.token));
		expect(got.headers['content-type']).toBe('image/png');

		const reportId = await createAndGenerate(agency.token, { location_id: agency.id, type: 'rank_tracker' });
		await request(app).delete('/api/v1/organization/branding/logo').set(auth(agency.token));
		const snap = await ReportSnapshot.findOne({ report_id: reportId }).lean();
		expect(snap?.branding).toMatchObject({ name: 'Acme SEO', primary_color: '#aa0000', hide_mypageseo: true, logo: { mime: 'image/png', data_base64: PNG } });
		expect((await request(app).get('/api/v1/organization/branding/logo').set(auth(agency.token))).status).toBe(404);

		const { user: m, token: mToken } = await createUser('member@test.dev');
		await addMember(agency.org._id, m._id, 'member');
		expect((await request(app).put('/api/v1/organization/branding').set(auth(mToken)).send({ agency_name: 'x' })).body.data).toMatchObject({ reason: 'owner_only' });
		expect((await request(app).get('/api/v1/organization/branding').set(auth(mToken))).body.data.name).toBe('Acme SEO');

		const business = await setup();
		expect((await request(app).put('/api/v1/organization/branding').set(auth(business.token)).send({ agency_name: 'x' })).body.data).toMatchObject({ reason: 'agency_only' });
		expect((await request(app).get('/api/v1/organization/branding').set(auth(business.token))).body.data).toMatchObject({ white_label: false, name: 'MyPageSEO', hide_mypageseo: false });
	});
});
