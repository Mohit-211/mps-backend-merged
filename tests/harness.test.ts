import { MongoClient } from 'mongodb';
import { startMemoryMongo } from './helpers/memoryMongo';

describe('test harness', () => {
	it('runs TypeScript tests with the placeholder environment and no Places key', () => {
		expect(process.env.NODE_ENV).toBe('test');
		expect(process.env.ENV_FILE).toMatch(/\.env\.example$/);
		expect(process.env.GOOGLE_PLACE_API_KEY ?? '').toBe('');
	});

	it('starts an in-memory MongoDB', async () => {
		const server = await startMemoryMongo();
		const client = await MongoClient.connect(server.getUri());
		try {
			const ping = await client.db('mps_test').command({ ping: 1 });
			expect(ping.ok).toBe(1);
		} finally {
			await client.close();
			await server.stop();
		}
	}, 120000);
});
