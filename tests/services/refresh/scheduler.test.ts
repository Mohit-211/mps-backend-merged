import { Types } from 'mongoose';
import { GbpSync, ILocation, Location, RankRun, UserGBP } from '../../../src/models';
import { failStuckRuns, runMonthlyRefreshTick } from '../../../src/services/refresh/scheduler.service';
import { clearDb, createLocation, createUser, keywordsOf, startTestDb } from '../../helpers/mongoose';

jest.mock('../../../src/configs/mongoConnection', () => ({ agenda: {} }));

const NOW = new Date('2026-10-12T09:10:00Z');

let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
	await Promise.all([RankRun.syncIndexes(), GbpSync.syncIndexes(), UserGBP.syncIndexes()]);
});
afterAll(async () => db.stop());
beforeEach(async () => clearDb());

const setup = () => {
	const runs: string[] = [];
	const syncs: string[] = [];
	const deps = {
		enqueueRun: async (l: ILocation) => void runs.push(String(l._id)),
		enqueueSync: async (l: ILocation) => void syncs.push(String(l._id)),
	};
	return { runs, syncs, deps };
};

const scheduled = async (userId: Types.ObjectId, over: { frequency?: 'auto_monthly' | 'manual_only'; next?: Date | null; keywords?: boolean } = {}) => {
	const location = await createLocation(userId, {
		lng: -96.8,
		tracking: { keywords: over.keywords === false ? [] : keywordsOf('plumber'), frequency: over.frequency ?? 'auto_monthly' },
	});
	await Location.updateOne(
		{ _id: location._id },
		{ $set: { refresh: { anchor_day: 12, next_refresh_at: over.next === undefined ? new Date('2026-10-12T09:00:00Z') : over.next, last_auto_refresh_at: null, last_manual: { rankings: null, gbp: null } } } },
	);
	return location;
};

describe('monthly-refresh tick', () => {
	it('refreshes due auto_monthly locations with keywords: rank run always, GBP sync only when bound', async () => {
		const { user } = await createUser('s@test.dev');
		const uid = user._id as Types.ObjectId;
		const bound = await scheduled(uid);
		const unbound = await scheduled(uid);
		await UserGBP.create({ user_id: uid, location_id: bound._id, gbpAccountId: 'accounts/1', gbpLocationId: 'locations/1' });
		await scheduled(uid, { frequency: 'manual_only' });
		await scheduled(uid, { next: new Date('2026-11-12T09:00:00Z') }); // not due
		await scheduled(uid, { keywords: false });
		await scheduled(uid, { next: null });

		const { runs, syncs, deps } = setup();
		const result = await runMonthlyRefreshTick(NOW, deps);
		expect(result).toMatchObject({ due: 2, refreshed: 2, rank_runs: 2, gbp_syncs: 1, failed: 0 });
		expect(runs.sort()).toEqual([String(bound._id), String(unbound._id)].sort());
		expect(syncs).toEqual([String(bound._id)]);

		const after = await Location.findById(bound._id).lean<ILocation>();
		expect(after?.refresh?.next_refresh_at?.toISOString()).toBe('2026-11-12T09:00:00.000Z'); // next anchor date, UTC-6
		expect(after?.refresh?.last_auto_refresh_at?.toISOString()).toBe(NOW.toISOString());
	});

	it('claims each location once, even with overlapping ticks', async () => {
		const { user } = await createUser('s2@test.dev');
		await scheduled(user._id as Types.ObjectId);
		const { runs, deps } = setup();
		await Promise.all([runMonthlyRefreshTick(NOW, deps), runMonthlyRefreshTick(NOW, deps), runMonthlyRefreshTick(NOW, deps)]);
		expect(runs).toHaveLength(1);
	});

	it('a failed enqueue is recorded and does not re-fire on the next tick', async () => {
		const { user } = await createUser('s3@test.dev');
		const location = await scheduled(user._id as Types.ObjectId);
		const failing = { enqueueRun: async () => Promise.reject(new Error('Location has no place_id')), enqueueSync: async () => undefined };
		expect((await runMonthlyRefreshTick(NOW, failing)).failed).toBe(1);
		expect((await Location.findById(location._id).lean<ILocation>())?.tracking?.last_error).toMatch(/monthly rank run not started/);
		expect((await runMonthlyRefreshTick(new Date(NOW.getTime() + 15 * 60_000), failing)).due).toBe(0);
	});

	it('fails stuck rank runs and GBP syncs', async () => {
		const { user } = await createUser('s4@test.dev');
		const location = await createLocation(user._id as Types.ObjectId);
		const old = new Date(NOW.getTime() - 45 * 60_000);
		await RankRun.collection.insertOne({ location_id: location._id, status: 'running', active: true, started_at: old, run_at: old });
		await GbpSync.create({
			location_id: location._id,
			created_by: user._id,
			gbp_location_id: 'locations/1',
			gbp_account_id: 'accounts/1',
			trigger: 'scheduled',
			status: 'queued',
			run_at: old,
		});
		const result = await runMonthlyRefreshTick(NOW, setup().deps);
		expect(result.stuck).toEqual({ runs: 1, syncs: 1 });
		expect(await GbpSync.findOne({}).lean()).toMatchObject({ status: 'failed', active: false, failure_reason: 'never started: queued > 30 min' });
		expect((await failStuckRuns(NOW)).running).toBe(0);
	});
});
