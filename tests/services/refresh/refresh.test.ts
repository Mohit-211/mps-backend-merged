import { Types } from 'mongoose';
import { GbpSync, ILocation, Location, RankRun, UserGBP } from '../../../src/models';
import { EnqueueResult } from '../../../src/services/ranking/rankRun.service';
import { getRefreshState, refreshLocation } from '../../../src/services/refresh/refresh.service';
import { clearDb, createLocation, createUser, keywordsOf, startTestDb } from '../../helpers/mongoose';

jest.mock('../../../src/configs/mongoConnection', () => ({ agenda: {} }));

const NOW = new Date('2026-10-01T12:00:00Z');
const H = 3600_000;

let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
	await Promise.all([RankRun.syncIndexes(), GbpSync.syncIndexes(), UserGBP.syncIndexes()]);
});
afterAll(async () => db.stop());
beforeEach(async () => clearDb());

const setup = () => {
	const calls = { runs: 0, syncs: 0 };
	return {
		calls,
		deps: (now: Date = NOW) => ({
			now,
			minIntervalHours: 24,
			enqueueRun: async (): Promise<EnqueueResult> => {
				calls.runs += 1;
				return { run_id: `run-${calls.runs}`, status: 'queued', existing: false, estimate: {} as EnqueueResult['estimate'], dev_capped: false };
			},
			enqueueSync: async () => {
				calls.syncs += 1;
				return { sync_id: `sync-${calls.syncs}`, status: 'queued', existing: false, estimated_calls: 7 };
			},
		}),
	};
};

const newLocation = async (bound: boolean) => {
	const { user } = await createUser(`r${Math.random()}@test.dev`);
	const location = await createLocation(user._id as Types.ObjectId, { tracking: { keywords: keywordsOf('plumber') } });
	if (bound) await UserGBP.create({ user_id: user._id, location_id: location._id, gbpAccountId: 'accounts/1', gbpLocationId: 'locations/1' });
	return { user, location };
};

describe('manual refresh', () => {
	it('defaults to rankings + gbp when bound; returns next_allowed_at 24 h later', async () => {
		const { user, location } = await newLocation(true);
		const { calls, deps } = setup();
		const result = await refreshLocation(location, user._id, undefined, deps());
		expect(calls).toEqual({ runs: 1, syncs: 1 });
		expect(result.rankings).toMatchObject({ run_id: 'run-1', next_allowed_at: new Date(NOW.getTime() + 24 * H) });
		expect(result.gbp).toMatchObject({ sync_id: 'sync-1', next_allowed_at: new Date(NOW.getTime() + 24 * H) });
		expect(result.all_rate_limited).toBe(false);
	});

	it('rankings only (and gbp_not_connected) for an unbound location', async () => {
		const { user, location } = await newLocation(false);
		const { calls, deps } = setup();
		expect((await refreshLocation(location, user._id, undefined, deps())).gbp).toBeUndefined();
		const explicit = await refreshLocation(location, user._id, ['gbp'], deps(new Date(NOW.getTime() + 25 * H)));
		expect(explicit.gbp).toEqual({ skipped: 'gbp_not_connected', next_allowed_at: null });
		expect(calls.syncs).toBe(0);
	});

	it('limits each type to once per 24 h, independently; all limited → all_rate_limited', async () => {
		const { user, location } = await newLocation(true);
		const { calls, deps } = setup();
		await refreshLocation(location, user._id, ['rankings'], deps());
		const second = await refreshLocation(location, user._id, undefined, deps(new Date(NOW.getTime() + 2 * H)));
		expect(second.rankings).toEqual({ skipped: 'rate_limited', next_allowed_at: new Date(NOW.getTime() + 24 * H) });
		expect(second.gbp).toMatchObject({ sync_id: 'sync-1' }); // gbp was still allowed
		expect(second.all_rate_limited).toBe(false);
		const third = await refreshLocation(location, user._id, undefined, deps(new Date(NOW.getTime() + 3 * H)));
		expect(third.all_rate_limited).toBe(true);
		const nextDay = await refreshLocation(location, user._id, ['rankings'], deps(new Date(NOW.getTime() + 24 * H + 1)));
		expect(nextDay.rankings).toMatchObject({ run_id: 'run-2' });
		expect(calls).toEqual({ runs: 2, syncs: 1 });
	});

	it('parallel clicks queue once', async () => {
		const { user, location } = await newLocation(false);
		const { calls, deps } = setup();
		const results = await Promise.all([1, 2, 3, 4].map(() => refreshLocation(location, user._id, ['rankings'], deps())));
		expect(calls.runs).toBe(1);
		expect(results.filter((r) => r.all_rate_limited)).toHaveLength(3);
	});

	it('an active run is returned without using up the limit', async () => {
		const { user, location } = await newLocation(false);
		await RankRun.collection.insertOne({ location_id: location._id, status: 'running', active: true, run_at: NOW });
		const { deps } = setup();
		await refreshLocation(location, user._id, ['rankings'], deps());
		expect((await Location.findById(location._id).lean<ILocation>())?.refresh?.last_manual?.rankings ?? null).toBeNull();
	});

	it('gives the slot back when queuing fails', async () => {
		const { user, location } = await newLocation(false);
		const failing = { ...setup().deps(), enqueueRun: async () => Promise.reject(new Error('Location has no tracking keywords')) };
		await expect(refreshLocation(location, user._id, ['rankings'], failing)).rejects.toThrow('no tracking keywords');
		expect((await Location.findById(location._id).lean<ILocation>())?.refresh?.last_manual?.rankings ?? null).toBeNull();
	});

	it('button state shows next_allowed_at, active work and the schedule', async () => {
		const { user, location } = await newLocation(true);
		await refreshLocation(location, user._id, ['rankings'], setup().deps());
		const state = await getRefreshState(location, new Date(NOW.getTime() + H), 24);
		expect(state).toMatchObject({
			frequency: 'auto_monthly',
			gbp_connected: true,
			rankings: { next_allowed_at: new Date(NOW.getTime() + 24 * H) },
			gbp: { next_allowed_at: null, active_sync: null },
		});
	});
});
