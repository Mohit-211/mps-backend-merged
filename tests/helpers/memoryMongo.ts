import { MongoMemoryServer } from 'mongodb-memory-server';

// In-memory MongoDB for integration tests. Phase 13b (flaky tests): ONE server for the whole run,
// started by tests/globalSetup.ts before any worker exists; every test file gets its own database on it.
// Before, every test file started its own mongod on a random port while other workers were opening
// supertest servers on OS-assigned ports: a port could be taken twice (mongod on 127.0.0.1, Node on ::),
// so an HTTP request sometimes reached a database or another worker's app ("Parse Error", 404s, empty
// bodies) and a mongod sometimes failed with "Port already in use".
// The binary version is pinned in package.json (config.mongodbMemoryServer.version).
// Set MONGOMS_SYSTEM_BINARY to use a locally installed mongod instead of downloading one.

export const startMemoryMongo = async (): Promise<MongoMemoryServer> => MongoMemoryServer.create({ instance: { dbName: 'mps_test' } });

/** The shared server's URI (set by globalSetup). */
export const testMongoUri = (): string => {
	const uri = process.env.MPS_TEST_MONGO_URI;
	if (!uri) throw new Error('MPS_TEST_MONGO_URI is not set: run the tests through jest (tests/globalSetup.ts starts the server).');
	return uri;
};

let counter = 0;
/** A database name unique to this worker and test file. */
export const uniqueDbName = (prefix = 't'): string => `${prefix}_${process.env.JEST_WORKER_ID ?? '0'}_${process.pid}_${Date.now().toString(36)}_${++counter}`;

/** The shared server's URI for one database. */
export const testMongoUriFor = (dbName: string): string => `${testMongoUri().replace(/\/?$/, '/')}${dbName}`;
