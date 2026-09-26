import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { resolveMongooseDebug } from '../../src/configs/mongooseDebug';

type ConfigModule = typeof import('../../src/configs/config');

const withEnv = <T>(overrides: Record<string, string | undefined>, fn: () => T): T => {
	const base = dotenv.parse(fs.readFileSync(path.resolve(__dirname, '../../.env.example')));
	const saved = { ...process.env };
	process.env = { ...base, NODE_ENV: 'test', ENV_FILE: '/nonexistent/.env' };
	for (const [key, value] of Object.entries(overrides)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	try {
		return fn();
	} finally {
		process.env = saved;
	}
};

describe('resolveMongooseDebug', () => {
	it('is off unless requested', () => {
		expect(resolveMongooseDebug('development', false)).toEqual({ enabled: false, warning: null });
		expect(resolveMongooseDebug('production', false)).toEqual({ enabled: false, warning: null });
	});

	it('turns on only in development', () => {
		expect(resolveMongooseDebug('development', true)).toEqual({ enabled: true, warning: null });
	});

	it.each(['production', 'test'])('is ignored with a warning in %s', (env) => {
		const setting = resolveMongooseDebug(env, true);
		expect(setting.enabled).toBe(false);
		expect(setting.warning).toContain('MONGOOSE_DEBUG=true ignored');
	});
});

describe('MONGOOSE_DEBUG config', () => {
	const load = (overrides: Record<string, string | undefined>) =>
		withEnv(overrides, () => {
			let loaded: ConfigModule['default'] | undefined;
			jest.isolateModules(() => {
				// eslint-disable-next-line @typescript-eslint/no-require-imports
				loaded = (require('../../src/configs/config') as ConfigModule).default;
			});
			return loaded as ConfigModule['default'];
		});

	it('defaults to false when unset', () => {
		expect(load({ MONGOOSE_DEBUG: undefined }).databases.mongodb.debug).toBe(false);
	});

	it('reads true', () => {
		expect(load({ MONGOOSE_DEBUG: 'true' }).databases.mongodb.debug).toBe(true);
	});
});

describe('mongoConnection', () => {
	const connect = (overrides: Record<string, string | undefined>) =>
		withEnv(overrides, () => {
			const set = jest.fn();
			const warn = jest.fn();
			const sigintBefore = process.listeners('SIGINT');
			jest.isolateModules(() => {
				jest.doMock('mongoose', () => ({
					__esModule: true,
					default: { connect: jest.fn(async () => undefined), set, connection: { on: jest.fn(), once: jest.fn() } },
				}));
				jest.doMock('../../src/configs/agenda', () => ({ getAgenda: () => ({}), stopAgenda: jest.fn() }));
				jest.doMock('../../src/configs/logger', () => ({ __esModule: true, default: { info: jest.fn(), warn } }));
				// eslint-disable-next-line @typescript-eslint/no-require-imports
				require('../../src/configs/mongoConnection');
			});
			for (const l of process.listeners('SIGINT')) if (!sigintBefore.includes(l)) process.removeListener('SIGINT', l);
			return { set, warn };
		});

	it('leaves query logging off by default', () => {
		const { set, warn } = connect({ MONGOOSE_DEBUG: undefined });
		expect(set).toHaveBeenCalledWith('debug', false);
		expect(warn).not.toHaveBeenCalled();
	});

	it('ignores MONGOOSE_DEBUG=true outside development, with a warning', () => {
		const { set, warn } = connect({ MONGOOSE_DEBUG: 'true', NODE_ENV: 'production', TOKEN_ENCRYPTION_KEY: 'a'.repeat(64) });
		expect(set).toHaveBeenCalledWith('debug', false);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('MONGOOSE_DEBUG=true ignored'));
	});

	it('enables it in development when requested', () => {
		const { set } = connect({ MONGOOSE_DEBUG: 'true', NODE_ENV: 'development' });
		expect(set).toHaveBeenCalledWith('debug', true);
	});
});
