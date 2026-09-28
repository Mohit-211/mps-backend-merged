import { startMemoryMongo } from './helpers/memoryMongo';

// Phase 13b: one in-memory MongoDB for the whole test run (see tests/helpers/memoryMongo.ts). Workers are
// started after this, so they inherit MPS_TEST_MONGO_URI.
export default async function globalSetup(): Promise<void> {
	const server = await startMemoryMongo();
	(globalThis as { __MPS_MONGO__?: unknown }).__MPS_MONGO__ = server;
	process.env.MPS_TEST_MONGO_URI = server.getUri();
}
