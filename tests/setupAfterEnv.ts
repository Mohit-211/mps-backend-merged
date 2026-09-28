import http from 'http';
import https from 'https';
import logger from '../src/configs/logger';

// Keep test output readable; set TEST_LOGS=1 to see winston output.
logger.silent = process.env.TEST_LOGS !== '1';

// In-memory MongoDB start-up can exceed the default 5 s hook timeout when many suites run in parallel.
jest.setTimeout(30000);

// Phase 13b (flaky tests): no HTTP keep-alive in tests. Node ≥ 19 keeps connections alive by default, and
// the global agent is shared by every test file that runs in the same worker. supertest closes each test
// server's listener after the request, but the kept-alive connection stayed in the pool under
// "127.0.0.1:<port>"; when a later test file's server got the same port number, its request reused that
// connection and was answered by the previous file's app (a 404, or another app's state).
http.globalAgent = new http.Agent({ keepAlive: false });
https.globalAgent = new https.Agent({ keepAlive: false });

// Phase 13b (flaky tests): requests to test servers go to [::1], not 127.0.0.1. supertest calls app.listen(0),
// which binds the dual-stack wildcard [::]:<port>, and then sent the request to 127.0.0.1:<port>. On macOS the
// kernel can hand out a wildcard port that some process already listens on at 127.0.0.1 (a different binding,
// e.g. the shared test mongod), and that listener, being more specific, received the request: "Parse Error:
// Expected HTTP/", a 404 or an empty body. Nothing listens on [::1] specifically, so the request always
// reaches the wildcard server. (Binding 127.0.0.1 instead isn't possible: supertest reads address()
// synchronously, and Node resolves an explicit host asynchronously.)
const originalAddress = http.Server.prototype.address;
http.Server.prototype.address = function loopbackAddress(this: http.Server) {
	const addr = originalAddress.call(this);
	return addr && typeof addr === 'object' && addr.address === '::' ? { ...addr, address: '::1' } : addr;
};
