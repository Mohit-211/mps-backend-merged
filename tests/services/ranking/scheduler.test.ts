import { Agenda } from 'agenda';
import { Types } from 'mongoose';
import { ILocation, Location, RankRun } from '../../../src/models';
import { enqueueRankRun } from '../../../src/services/ranking/rankRun.service';
import { failStuckRuns, scheduleDueRuns } from '../../../src/services/ranking/scheduler.service';
import { clearDb, createLocation, createUser, keywordsOf, startTestDb } from '../../helpers/mongoose';

const NOW = new Date('2026-09-26T10:00:00Z');
const HOUR = 60 * 60 * 1000;

let db: { stop: () => Promise<void> };
let userId: Types.ObjectId;

beforeAll(async () => {
	db = await startTestDb();
}, 120000);
afterAll(async () => db.stop());
beforeEach(async () => {
	await clearDb();
	userId = (await createUser('owner@example.test')).user._id;
});

const agenda = { schedule: jest.fn(async () => ({})) } as unknown as Agenda;
const realEnqueue = jest.fn((location: ILocation) =>
	enqueueRankRun(location, String(location.created_by), 'scheduled', { agenda, now: NOW, planOptions: { env: 'production' } }),
);

const tracked = (frequency: 'weekly' | 'monthly' | 'manual', nextRunAt: Date | null, keywords = keywordsOf('plumber')) =>
	createLocation(userId, { tracking: { keywords, frequency, next_run_at: nextRunAt, grid: { size: 3, spacing_km: 1 } } });

const nextRunOf = async (id: unknown): Promise<Date | null | undefined> =>
	(await Location.findOne({ _id: id }))?.tracking?.next_run_at;

describe('scheduleDueRuns', () => {
	beforeEach(() => realEnqueue.mockClear());

	it('picks due weekly and monthly locations and advances next_run_at', async () => {
		const weekly = await tracked('weekly', new Date(NOW.getTime() - HOUR));
		const monthly = await tracked('monthly', new Date('2026-09-26T09:00:00Z'));
		const result = await scheduleDueRuns(NOW, { enqueue: realEnqueue });
		expect(result).toEqual({ due: 2, enqueued: 2, failed: 0 });
		expect(await RankRun.countDocuments({ trigger: 'scheduled' })).toBe(2);
		expect(await nextRunOf(weekly._id)).toEqual(new Date('2026-10-03T09:00:00Z'));
		expect(await nextRunOf(monthly._id)).toEqual(new Date('2026-10-26T09:00:00Z'));
	});

	it('skips manual, future, keyword-less and inactive locations', async () => {
		await tracked('manual', null);
		await tracked('weekly', new Date(NOW.getTime() + HOUR));
		await tracked('weekly', new Date(NOW.getTime() - HOUR), []);
		const inactive = await tracked('weekly', new Date(NOW.getTime() - HOUR));
		await Location.updateOne({ _id: inactive._id }, { $set: { is_active: false } });
		const result = await scheduleDueRuns(NOW, { enqueue: realEnqueue });
		expect(result).toEqual({ due: 0, enqueued: 0, failed: 0 });
		expect(realEnqueue).not.toHaveBeenCalled();
	});

	it('catches up after an outage with a single run, not a burst', async () => {
		const location = await tracked('weekly', new Date('2026-08-01T10:00:00Z'));
		await scheduleDueRuns(NOW, { enqueue: realEnqueue });
		expect(realEnqueue).toHaveBeenCalledTimes(1);
		const next = (await nextRunOf(location._id)) as Date;
		expect(next.getTime()).toBeGreaterThan(NOW.getTime());
		expect(next).toEqual(new Date('2026-10-03T10:00:00Z'));
	});

	it('claims each location atomically: two overlapping ticks enqueue once', async () => {
		await tracked('weekly', new Date(NOW.getTime() - HOUR));
		const [a, b] = await Promise.all([
			scheduleDueRuns(NOW, { enqueue: realEnqueue }),
			scheduleDueRuns(NOW, { enqueue: realEnqueue }),
		]);
		expect(a.enqueued + b.enqueued).toBe(1);
		expect(realEnqueue).toHaveBeenCalledTimes(1);
		expect(await RankRun.countDocuments()).toBe(1);
	});

	it('records a failed enqueue on the location and still advances next_run_at', async () => {
		const location = await createLocation(userId, {
			place_id: null,
			tracking: { keywords: keywordsOf('plumber'), frequency: 'weekly', next_run_at: new Date(NOW.getTime() - HOUR) },
		});
		const result = await scheduleDueRuns(NOW, { enqueue: realEnqueue });
		expect(result).toEqual({ due: 1, enqueued: 0, failed: 1 });
		const saved = await Location.findOne({ _id: location._id });
		expect(saved?.tracking?.last_error).toContain('no place_id');
		expect((saved?.tracking?.next_run_at as Date).getTime()).toBeGreaterThan(NOW.getTime());
	});
});

describe('failStuckRuns', () => {
	const makeRun = (status: 'queued' | 'running' | 'done', runAt: Date, startedAt: Date | null) =>
		RankRun.create({
			location_id: new Types.ObjectId(),
			created_by: userId,
			trigger: 'manual',
			status,
			active: status !== 'done',
			run_at: runAt,
			started_at: startedAt,
			keywords_version: 1,
			region: 'ca',
			config: { grid_size: 3, spacing_km: 1, tracker_offset_km: 1.5, radius_m: 5000, store_place_names: true },
		});

	it('fails runs running > 30 min and queued > 30 min; leaves fresh and finished runs alone', async () => {
		const stuck = await makeRun('running', new Date(NOW.getTime() - 2 * HOUR), new Date(NOW.getTime() - 31 * 60 * 1000));
		const fresh = await makeRun('running', new Date(NOW.getTime() - HOUR), new Date(NOW.getTime() - 5 * 60 * 1000));
		const neverStarted = await makeRun('queued', new Date(NOW.getTime() - HOUR), null);
		const done = await makeRun('done', new Date(NOW.getTime() - 3 * HOUR), new Date(NOW.getTime() - 3 * HOUR));

		expect(await failStuckRuns(NOW)).toEqual({ running: 1, queued: 1 });
		expect(await RankRun.findById(stuck._id)).toMatchObject({ status: 'failed', active: false, failure_reason: 'stuck: running > 30 min' });
		expect(await RankRun.findById(neverStarted._id)).toMatchObject({ status: 'failed', active: false });
		expect(await RankRun.findById(fresh._id)).toMatchObject({ status: 'running', active: true });
		expect(await RankRun.findById(done._id)).toMatchObject({ status: 'done' });
	});
});
