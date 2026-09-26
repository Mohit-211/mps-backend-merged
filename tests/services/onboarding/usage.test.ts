import { PlacesUsage } from '../../../src/models';
import { createPlacesUsage, utcDay } from '../../../src/services/onboarding/usage';
import { clearDb, createUser, startTestDb } from '../../helpers/mongoose';

jest.mock('../../../src/configs/mongoConnection', () => ({ agenda: {} }));

let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
	await PlacesUsage.syncIndexes();
});
afterAll(async () => db.stop());
beforeEach(async () => clearDb());

describe('daily Places usage cap', () => {
	it('counts calls and refuses the reservation that would exceed the limit (429)', async () => {
		const { user } = await createUser('u@test.dev');
		const usage = createPlacesUsage({ limit: 5, now: () => new Date('2026-09-26T10:00:00Z') });
		await usage.reserve(user._id, 2);
		await usage.reserve(user._id, 3);
		expect(await usage.used(user._id)).toBe(5);
		await expect(usage.reserve(user._id, 1)).rejects.toMatchObject({ statusCode: 429 });
		expect(await usage.used(user._id)).toBe(5);
	});

	it('refuses a single request larger than the limit', async () => {
		const { user } = await createUser('u@test.dev');
		await expect(createPlacesUsage({ limit: 3 }).reserve(user._id, 4)).rejects.toMatchObject({ statusCode: 429 });
		expect(await PlacesUsage.countDocuments({})).toBe(0);
	});

	it('holds under concurrent reservations', async () => {
		const { user } = await createUser('u@test.dev');
		const usage = createPlacesUsage({ limit: 10, now: () => new Date('2026-09-26T10:00:00Z') });
		const results = await Promise.allSettled(Array.from({ length: 25 }, () => usage.reserve(user._id, 1)));
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(10);
		expect(await usage.used(user._id)).toBe(10);
	});

	it('resets on a new UTC day and keeps users separate', async () => {
		const { user: a } = await createUser('a@test.dev');
		const { user: b } = await createUser('b@test.dev');
		let now = new Date('2026-09-26T23:59:00Z');
		const usage = createPlacesUsage({ limit: 1, now: () => now });
		await usage.reserve(a._id, 1);
		await usage.reserve(b._id, 1);
		await expect(usage.reserve(a._id, 1)).rejects.toMatchObject({ statusCode: 429 });
		now = new Date('2026-09-27T00:01:00Z');
		await expect(usage.reserve(a._id, 1)).resolves.toBeUndefined();
		expect(utcDay(now)).toBe('2026-09-27');
	});
});
