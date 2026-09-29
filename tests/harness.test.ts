import { MongoClient } from 'mongodb';
import { testMongoUri } from './helpers/memoryMongo';

describe('test harness', () => {
	it('runs TypeScript tests with the placeholder environment and no Places key', () => {
		expect(process.env.NODE_ENV).toBe('test');
		expect(process.env.ENV_FILE).toMatch(/\.env\.example$/);
		expect(process.env.GOOGLE_PLACE_API_KEY ?? '').toBe('');
	});

	it('reaches the run\'s shared in-memory MongoDB (tests/globalSetup.ts)', async () => {
		const client = await MongoClient.connect(testMongoUri());
		try {
			const ping = await client.db('admin').command({ ping: 1 });
			expect(ping.ok).toBe(1);
		} finally {
			await client.close();
		}
	});
});
