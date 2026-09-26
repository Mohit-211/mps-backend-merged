import { Types } from 'mongoose';
import { ILocation, Location } from '../../../src/models';
import { migrateRefreshSchedule } from '../../../src/services/refresh/migrate';
import { clearDb, createLocation, createUser, keywordsOf, startTestDb } from '../../helpers/mongoose';

jest.mock('../../../src/configs/mongoConnection', () => ({ agenda: {} }));

let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
});
afterAll(async () => db.stop());
beforeEach(async () => clearDb());

const NOW = new Date('2026-10-01T00:00:00Z');

describe('migrate:refresh', () => {
	it('maps frequencies, schedules set-up locations, and is idempotent', async () => {
		const { user } = await createUser('m@test.dev');
		const uid = user._id as Types.ObjectId;
		const weekly = await createLocation(uid, { lng: 0, tracking: { keywords: keywordsOf('plumber') } });
		const manual = await createLocation(uid, { lng: 0, tracking: { keywords: keywordsOf('plumber') } });
		const empty = await createLocation(uid, { tracking: { keywords: [] } });
		// Pre-7b values written directly (the schema no longer accepts them).
		await Location.collection.updateOne({ _id: weekly._id }, { $set: { 'tracking.frequency': 'weekly', created_at: new Date('2026-05-17T10:00:00Z') } });
		await Location.collection.updateOne({ _id: manual._id }, { $set: { 'tracking.frequency': 'manual' } });

		expect(await migrateRefreshSchedule(NOW)).toEqual({ frequencies: { auto_monthly: 1, manual_only: 1 }, scheduled: 2 });
		const w = await Location.findById(weekly._id).lean<ILocation>();
		expect(w?.tracking?.frequency).toBe('auto_monthly');
		expect(w?.refresh).toMatchObject({ anchor_day: 17 });
		expect(w?.refresh?.next_refresh_at?.toISOString()).toBe('2026-10-17T03:00:00.000Z');
		const m = await Location.findById(manual._id).lean<ILocation>();
		expect(m?.tracking?.frequency).toBe('manual_only');
		expect(m?.refresh?.next_refresh_at ?? null).toBeNull();
		expect((await Location.findById(empty._id).lean<ILocation>())?.refresh).toBeUndefined();

		expect(await migrateRefreshSchedule(NOW)).toEqual({ frequencies: { auto_monthly: 0, manual_only: 0 }, scheduled: 0 });
	});
});
