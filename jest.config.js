/** @type {import('jest').Config} */
module.exports = {
	testEnvironment: 'node',
	roots: ['<rootDir>/tests'],
	testMatch: ['**/*.test.ts'],
	setupFiles: ['<rootDir>/tests/setupEnv.ts'],
	setupFilesAfterEnv: ['<rootDir>/tests/setupAfterEnv.ts'],
	// Workers transpile only (tests/tsconfig.jest.json has isolatedModules); `npm test` type-checks
	// src and tests once up front with `tsc -p tests/tsconfig.json`. Type-checking inside every worker
	// made parallel workers too slow to exit ("worker failed to exit gracefully").
	transform: {
		'^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tests/tsconfig.jest.json' }],
	},
	clearMocks: true,
	restoreMocks: true,
};
