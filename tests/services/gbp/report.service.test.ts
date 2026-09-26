import { Agenda } from 'agenda';
import { Types } from 'mongoose';
import { createDemoDetailsClient } from '../../../src/gbp/demo/demoGbp';
import { GbpReport, GbpSync, Location, RankRun } from '../../../src/models';
import { reportState, requestReport, runReportJob } from '../../../src/services/gbp/report.service';
import { clearDb, createLocation, createUser, startTestDb } from '../../helpers/mongoose';

jest.mock('../../../src/configs/mongoConnection', () => ({ agenda: {} }));

const NOW = new Date('2026-09-26T12:00:00Z');

let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
	await Promise.all([GbpReport.syncIndexes(), GbpSync.syncIndexes()]);
}, 60000);
afterAll(async () => db.stop());
beforeEach(async () => clearDb());

const fakeAgenda = () => {
	const scheduled: { when: Date; name: string; data: Record<string, string> }[] = [];
	const agenda = { schedule: jest.fn(async (when: Date, name: string, data: Record<string, string>) => scheduled.push({ when, name, data })) } as unknown as Agenda;
	return { agenda, scheduled };
};

const location = async () => {
	const { user } = await createUser(`u${Math.random()}@test.dev`);
	return String((await createLocation(user._id as Types.ObjectId))._id);
};

const deps = { places: createDemoDetailsClient(), now: () => NOW, v4Enabled: false };

describe('requestReport (debounce)', () => {
	it('the first request schedules one gbp-report job after the debounce; later requests do nothing', async () => {
		const id = await location();
		const { agenda, scheduled } = fakeAgenda();
		const first = await requestReport(id, 'rank_run', { agenda, now: NOW, debounceSeconds: 120 });
		const second = await requestReport(id, 'gbp_sync', { agenda, now: new Date(NOW.getTime() + 30_000), debounceSeconds: 120 });
		expect(first).toEqual({ scheduled: true, scheduled_for: new Date(NOW.getTime() + 120_000) });
		expect(second).toEqual({ scheduled: false, scheduled_for: new Date(NOW.getTime() + 120_000) });
		expect(scheduled).toEqual([{ when: new Date(NOW.getTime() + 120_000), name: 'gbp-report', data: { location_id: id, trigger: 'rank_run' } }]);
	});

	it('parallel requests claim once', async () => {
		const id = await location();
		const { agenda, scheduled } = fakeAgenda();
		const results = await Promise.all(Array.from({ length: 5 }, () => requestReport(id, 'rank_run', { agenda, now: NOW })));
		expect(results.filter((r) => r.scheduled)).toHaveLength(1);
		expect(scheduled).toHaveLength(1);
	});

	it('a request pending for more than 30 minutes (lost job) is reclaimed', async () => {
		const id = await location();
		await Location.updateOne({ _id: id }, { $set: { 'gbp_report.scheduled_for': new Date(NOW.getTime() - 31 * 60_000) } });
		const { agenda, scheduled } = fakeAgenda();
		expect((await requestReport(id, 'gbp_sync', { agenda, now: NOW })).scheduled).toBe(true);
		expect(scheduled).toHaveLength(1);
	});

	it('releases the claim when scheduling fails', async () => {
		const id = await location();
		const agenda = { schedule: jest.fn(async () => Promise.reject(new Error('agenda down'))) } as unknown as Agenda;
		await expect(requestReport(id, 'rank_run', { agenda, now: NOW })).rejects.toThrow('agenda down');
		expect((await Location.findById(id).lean())?.gbp_report?.scheduled_for).toBeNull();
	});
});

describe('runReportJob', () => {
	it('clears the pending request and skips while a rank run or sync is active', async () => {
		const id = await location();
		await Location.updateOne({ _id: id }, { $set: { 'gbp_report.scheduled_for': NOW } });
		await RankRun.collection.insertOne({ location_id: new Types.ObjectId(id), status: 'running', active: true, run_at: NOW });
		expect(await runReportJob(id, 'gbp_sync', deps)).toEqual({ skipped: 'run_active' });
		expect(await GbpReport.countDocuments()).toBe(0);
		expect((await Location.findById(id).lean())?.gbp_report?.scheduled_for).toBeNull();
	});

	it('a rank run and a sync finishing close together produce one generation', async () => {
		const id = await location();
		const { agenda, scheduled } = fakeAgenda();
		const oid = new Types.ObjectId(id);
		const runId = (await RankRun.collection.insertOne({ location_id: oid, status: 'running', active: true, run_at: NOW })).insertedId;
		const syncId = (await GbpSync.collection.insertOne({ location_id: oid, status: 'running', active: true, run_at: NOW })).insertedId;

		// The rank run finishes first while the sync is still running…
		await RankRun.collection.updateOne({ _id: runId }, { $set: { status: 'done', active: false } });
		await requestReport(id, 'rank_run', { agenda, now: NOW });
		// …the sync finishes within the debounce window: no second job.
		await GbpSync.collection.updateOne({ _id: syncId }, { $set: { status: 'done', active: false } });
		await requestReport(id, 'gbp_sync', { agenda, now: new Date(NOW.getTime() + 60_000) });
		expect(scheduled).toHaveLength(1);
		await runReportJob(id, 'rank_run', deps);
		expect(await GbpReport.countDocuments({ location_id: id })).toBe(1);
	});

	it('the sync still running when the job fires: skipped, then its finish requests the one generation', async () => {
		const id = await location();
		const { agenda, scheduled } = fakeAgenda();
		const syncId = (await GbpSync.collection.insertOne({ location_id: new Types.ObjectId(id), status: 'running', active: true, run_at: NOW })).insertedId;
		await requestReport(id, 'rank_run', { agenda, now: NOW });
		expect(await runReportJob(id, 'rank_run', deps)).toEqual({ skipped: 'run_active' });
		await GbpSync.collection.updateOne({ _id: syncId }, { $set: { status: 'done', active: false } });
		expect((await requestReport(id, 'gbp_sync', { agenda, now: new Date(NOW.getTime() + 600_000) })).scheduled).toBe(true);
		await runReportJob(id, 'gbp_sync', deps);
		expect(scheduled).toHaveLength(2);
		expect(await GbpReport.countDocuments({ location_id: id })).toBe(1);
	});
});

describe('reportState', () => {
	it('pending while scheduled and not stale', () => {
		expect(reportState({ gbp_report: { scheduled_for: NOW, last_generated_at: null, force_competitors_at: null } }, NOW)).toEqual({
			pending: true,
			scheduled_for: NOW,
			last_generated_at: null,
		});
		expect(reportState({}, NOW)).toEqual({ pending: false, scheduled_for: null, last_generated_at: null });
	});
});
