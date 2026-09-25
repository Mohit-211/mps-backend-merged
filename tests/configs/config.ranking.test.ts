import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

const RANKING_KEYS = [
	'PLACES_SEARCH_RADIUS_M',
	'RANK_MAX_KEYWORDS',
	'RANK_TRACKER_OFFSET_KM',
	'RANK_DEV_MAX_KEYWORDS',
];

type ConfigModule = typeof import('../../src/configs/config');

// Loads config.ts in isolation with the placeholder env, minus/plus the given overrides.
const loadConfig = (overrides: Record<string, string | undefined>): ConfigModule['default'] => {
	const base = dotenv.parse(fs.readFileSync(path.resolve(__dirname, '../../.env.example')));
	const saved = { ...process.env };
	process.env = { ...base, NODE_ENV: 'test', ENV_FILE: '/nonexistent/.env' };
	for (const [key, value] of Object.entries(overrides)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	try {
		let loaded: ConfigModule['default'] | undefined;
		jest.isolateModules(() => {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			loaded = (require('../../src/configs/config') as ConfigModule).default;
		});
		return loaded as ConfigModule['default'];
	} finally {
		process.env = saved;
	}
};

describe('config.ranking', () => {
	it('applies defaults when the ranking variables are unset', () => {
		const unset = Object.fromEntries(RANKING_KEYS.map((k) => [k, undefined]));
		const config = loadConfig(unset);
		expect(config.ranking).toEqual({
			searchRadiusM: 5000,
			maxKeywords: 20,
			trackerOffsetKm: 1.5,
			devMaxKeywords: 2,
		});
	});

	it('reads overrides from the environment', () => {
		const config = loadConfig({ PLACES_SEARCH_RADIUS_M: '3000', RANK_TRACKER_OFFSET_KM: '2.5' });
		expect(config.ranking.searchRadiusM).toBe(3000);
		expect(config.ranking.trackerOffsetKm).toBe(2.5);
	});

	it('rejects out-of-range values at startup', () => {
		expect(() => loadConfig({ PLACES_SEARCH_RADIUS_M: '60000' })).toThrow(/PLACES_SEARCH_RADIUS_M/);
		expect(() => loadConfig({ RANK_MAX_KEYWORDS: 'abc' })).toThrow(/RANK_MAX_KEYWORDS/);
	});

	it('treats an empty GOOGLE_PLACE_API_KEY as unset rather than an error', () => {
		const config = loadConfig({ GOOGLE_PLACE_API_KEY: '' });
		expect(config.googleApis.placeApi.keySecret).toBe('');
	});
});
