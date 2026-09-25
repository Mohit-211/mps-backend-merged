import logger from '../src/configs/logger';

// Keep test output readable; set TEST_LOGS=1 to see winston output.
logger.silent = process.env.TEST_LOGS !== '1';
