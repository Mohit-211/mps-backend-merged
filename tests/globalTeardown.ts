import type { MongoMemoryServer } from 'mongodb-memory-server';

export default async function globalTeardown(): Promise<void> {
	const server = (globalThis as { __MPS_MONGO__?: MongoMemoryServer }).__MPS_MONGO__;
	if (server) await server.stop();
}
