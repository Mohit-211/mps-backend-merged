import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Phase 10 (AUDIT S19): production refuses to start with weak or shared JWT secrets.

type ConfigModule = typeof import('../../src/configs/config');

const loadConfig = (overrides: Record<string, string | undefined>): ConfigModule['default'] => {
	const base = dotenv.parse(fs.readFileSync(path.resolve(__dirname, '../../.env.example')));
	const saved = { ...process.env };
	process.env = { ...base, NODE_ENV: 'test', ENV_FILE: '/nonexistent/.env' };
	for (const [key, value] of Object.entries(overrides)) {
		if (value === undefined) Reflect.deleteProperty(process.env, key);
		else process.env[key] = value;
	}
	try {
		let loaded: ConfigModule['default'] | undefined;
		jest.isolateModules(() => {
			// oxlint-disable-next-line typescript/no-var-requires
			loaded = require('../../src/configs/config').default;
		});
		return loaded as ConfigModule['default'];
	} finally {
		process.env = saved;
	}
};

const STRONG = 'a'.repeat(40);
const ADMIN = 'b'.repeat(40);
const prod = { NODE_ENV: 'production', TOKEN_ENCRYPTION_KEY: '0123456789abcdef'.repeat(4), PAYPAL_WEBHOOK_ID: 'WH-TEST' };

describe('JWT secrets in production', () => {
	it('needs JWT_SECRET ≥ 32 characters and a separate ADMIN_JWT_SECRET ≥ 32 characters', () => {
		expect(loadConfig({ ...prod, JWT_SECRET: STRONG, ADMIN_JWT_SECRET: ADMIN }).constants.jwt.adminSecret).toBe(ADMIN);
		expect(() => loadConfig({ ...prod, JWT_SECRET: 'twelve-chars', ADMIN_JWT_SECRET: ADMIN })).toThrow(/JWT_SECRET/);
		expect(() => loadConfig({ ...prod, JWT_SECRET: STRONG, ADMIN_JWT_SECRET: '' })).toThrow(/ADMIN_JWT_SECRET/);
		expect(() => loadConfig({ ...prod, JWT_SECRET: STRONG, ADMIN_JWT_SECRET: 'short' })).toThrow(/ADMIN_JWT_SECRET/);
		expect(() => loadConfig({ ...prod, JWT_SECRET: STRONG, ADMIN_JWT_SECRET: STRONG })).toThrow(/ADMIN_JWT_SECRET/);
	});

	it('development and test keep working without ADMIN_JWT_SECRET', () => {
		expect(loadConfig({ ADMIN_JWT_SECRET: undefined }).constants.jwt.adminSecret).toBe('');
	});
});

describe('PayPal webhook id in production', () => {
	// Optional at startup (the id exists only after the webhook is created); webhooks are refused while it is empty.
	it('may be empty', () => {
		expect(loadConfig({ ...prod, JWT_SECRET: STRONG, ADMIN_JWT_SECRET: ADMIN, PAYPAL_WEBHOOK_ID: '' }).paypal.webhookId).toBe('');
	});
});
