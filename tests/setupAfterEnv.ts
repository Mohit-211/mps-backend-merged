import logger from '../src/configs/logger';

// Keep test output readable; set TEST_LOGS=1 to see winston output.
logger.silent = process.env.TEST_LOGS !== '1';

// In-memory MongoDB start-up can exceed the default 5 s hook timeout when many suites run in parallel.
jest.setTimeout(30000);
