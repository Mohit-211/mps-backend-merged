import { MongoMemoryServer } from 'mongodb-memory-server';

// Starts a throwaway in-memory MongoDB for integration tests.
// The binary version is pinned in package.json (config.mongodbMemoryServer.version).
// Set MONGOMS_SYSTEM_BINARY to use a locally installed mongod instead of downloading one.
export const startMemoryMongo = async (): Promise<MongoMemoryServer> =>
	MongoMemoryServer.create({ instance: { dbName: 'mps_test' } });
