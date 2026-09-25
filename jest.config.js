/** @type {import('jest').Config} */
module.exports = {
	testEnvironment: 'node',
	roots: ['<rootDir>/tests'],
	testMatch: ['**/*.test.ts'],
	setupFiles: ['<rootDir>/tests/setupEnv.ts'],
	setupFilesAfterEnv: ['<rootDir>/tests/setupAfterEnv.ts'],
	transform: {
		'^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tests/tsconfig.json' }],
	},
	clearMocks: true,
	restoreMocks: true,
};
