/*
 * Demo ranking data for frontend work, with NO API key and NO network:
 *
 *   npm run seed:rank-demo
 *
 * Creates (or recreates) a demo user + Toronto plumber location in mps_rebuild and 3 weekly
 * RankRuns produced by the real rank-run executor against the offline demo Places client
 * (src/ranking/demo/demoPlaces.ts). Prints the login, an access token and curl examples.
 *
 * Refuses to run unless NODE_ENV=development AND the connected database is mps_rebuild.
 * Only the demo user's own data is deleted and recreated.
 */
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import mongoose, { Types } from 'mongoose';
import { Agenda } from 'agenda';
import config from '../configs/config';
import { userStatusTypes, userTypes } from '../configs/constantTypes';
import { Location, Profile, RankRun, User, UserToken } from '../models';
import { DEMO_CENTER, DEMO_KEYWORDS, DEMO_PLACE_IDS, createDemoPlaces } from '../ranking/demo/demoPlaces';
import { generateAuthTokens } from '../services/common/token.service';
import { enqueueRankRun } from '../services/ranking/rankRun.service';
import { executeRankRun } from '../services/ranking/rankRunExecutor';
import { normaliseKeywords } from '../services/ranking/trackingSettings';

const DEMO_EMAIL = 'rank-demo@mypageseo.test';
const REQUIRED_DB = 'mps_rebuild';
const DAY = 24 * 60 * 60 * 1000;

// Demo timings: the run starts 5 s after it was queued and finishes 90 s later.
const demoClock = (runAt: Date): (() => Date) => {
	let calls = 0;
	return () => new Date(runAt.getTime() + (calls++ === 0 ? 5 : 95) * 1000);
};

const out = (line = ''): void => {
	process.stdout.write(`${line}\n`);
};

const fail = (message: string): never => {
	process.stderr.write(`seed:rank-demo refused: ${message}\n`);
	process.exit(1);
};

const removePreviousDemo = async (): Promise<void> => {
	const user = await User.findOne({ email: DEMO_EMAIL });
	if (!user) return;
	const locations = await Location.find({ created_by: user._id }).select({ _id: 1 });
	const locationIds = locations.map((l) => l._id);
	await RankRun.deleteMany({ $or: [{ created_by: user._id }, { location_id: { $in: locationIds } }] });
	await Location.deleteMany({ created_by: user._id });
	await Profile.deleteMany({ user_id: user._id });
	await UserToken.deleteMany({ user_id: user._id });
	await User.deleteOne({ _id: user._id });
};

const main = async (): Promise<void> => {
	if (config.essentials.env !== 'development') fail(`NODE_ENV is "${config.essentials.env}", not "development"`);

	await mongoose.connect(config.databases.mongodb.url, {
		user: config.databases.mongodb.user,
		pass: config.databases.mongodb.password,
		authSource: config.databases.mongodb.authSource,
		serverSelectionTimeoutMS: 10000,
	});
	const dbName = mongoose.connection.db?.databaseName;
	if (dbName !== REQUIRED_DB) {
		await mongoose.disconnect();
		fail(`connected database is "${dbName}", not "${REQUIRED_DB}"`);
	}
	await Promise.all([RankRun.syncIndexes(), Location.syncIndexes()]);

	await removePreviousDemo();

	const password = randomBytes(9).toString('base64url');
	const user = await User.create({
		email: DEMO_EMAIL,
		password: bcrypt.hashSync(password, 10),
		role_id: config.roles.user,
		user_type: userTypes.business,
		status: userStatusTypes.ACCEPTED,
	});
	await Profile.create({ user_id: user._id, name: 'Rank Demo', business_name: 'Maple Leaf Plumbing & Heating' });

	const now = Date.now();
	const location = await Location.create({
		name: 'Maple Leaf Plumbing & Heating',
		address: '100 Queen St E',
		country: 'Canada',
		state: 'Ontario',
		city: 'Toronto',
		zip_code: 'M5C 1S6',
		mobile: '4165550100',
		website_URL: 'https://mapleleafplumbing.example',
		business_category: 'Plumber',
		place_id: DEMO_PLACE_IDS.self,
		lat: DEMO_CENTER.lat,
		lng: DEMO_CENTER.lng,
		created_by: user._id,
		tracking: {
			keywords: normaliseKeywords(DEMO_KEYWORDS, config.ranking.maxKeywords),
			keywords_version: 1,
			keywords_updated_at: new Date(now - 21 * DAY),
			competitors: [DEMO_PLACE_IDS.competitor_1, DEMO_PLACE_IDS.competitor_2],
			grid: { size: 5, spacing_km: 1 },
			frequency: 'weekly',
			next_run_at: new Date(now + 7 * DAY),
			last_run_at: null,
			last_error: null,
		},
	});

	// The demo client is offline, so production limits are used (3 keywords, 5×5) for richer data.
	const noSchedule = { schedule: async () => ({}) } as unknown as Agenda;
	const runs: { runId: string; runAt: Date; status: string }[] = [];
	for (const run of [0, 1, 2] as const) {
		const runAt = new Date(now - (2 - run) * 7 * DAY);
		const fresh = await Location.findOne({ _id: location._id });
		if (!fresh) fail('demo location disappeared');
		const queued = await enqueueRankRun(fresh as NonNullable<typeof fresh>, user._id as Types.ObjectId, run < 2 ? 'scheduled' : 'manual', {
			agenda: noSchedule,
			now: runAt,
			planOptions: { env: 'production' },
		});
		const result = await executeRankRun(queued.run_id, {
			places: createDemoPlaces(run),
			engine: { sleep: async () => undefined },
			now: demoClock(runAt),
		});
		runs.push({ runId: queued.run_id, runAt, status: result.status });
	}

	const tokens = await generateAuthTokens(user);
	const baseUrl = `http://localhost:${config.essentials.port}/api/v1/locations/${String(location._id)}`;

	out('Rank demo data created in mps_rebuild (offline demo client: 0 Google API calls).');
	out();
	out(`  Login:        ${DEMO_EMAIL}`);
	out(`  Password:     ${password}`);
	out(`  Location id:  ${String(location._id)}`);
	out(`  Access token: ${tokens.access.token}`);
	out(`  (expires ${tokens.access.expires.toISOString()})`);
	out();
	out('  Runs:');
	for (const r of runs) out(`    ${r.runAt.toISOString().slice(0, 10)}  ${r.status.padEnd(8)} ${r.runId}`);
	out();
	out('  Try:');
	out(`    TOKEN='${tokens.access.token}'`);
	out(`    curl -s -H "Authorization: Bearer $TOKEN" ${baseUrl}/rank-tracker`);
	out(`    curl -s -H "Authorization: Bearer $TOKEN" "${baseUrl}/grid?keyword=Water%20Heater%20Repair"`);
	out(`    curl -s -H "Authorization: Bearer $TOKEN" "${baseUrl}/map-ranking?keyword=Emergency%20Plumber"`);
	out(`    curl -s -H "Authorization: Bearer $TOKEN" ${baseUrl}/rank-runs`);
	out(`    curl -s -H "Authorization: Bearer $TOKEN" ${baseUrl}/tracking`);

	await mongoose.disconnect();
	process.exit(0);
};

main().catch(async (err: Error) => {
	process.stderr.write(`seed:rank-demo failed: ${err.message}\n`);
	await mongoose.disconnect().catch(() => undefined);
	process.exit(1);
});
