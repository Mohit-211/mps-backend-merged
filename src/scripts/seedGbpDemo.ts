/*
 * Demo GBP report data for frontend work, with NO API key and NO network:
 *
 *   npm run seed:gbp-demo            (reviews, media and posts filled, as with GBP_V4_ENABLED=true)
 *   npm run seed:gbp-demo -- --v4-off (the report as it looks today, before v4 access)
 *
 * Creates (or recreates) a demo user with two Toronto plumber locations in mps_rebuild:
 * - "bound": a fake GBP binding, a finished sync, 18 months of daily metrics, 6 months of search
 *   keywords, a profile snapshot and ~60 reviews, 3 rank runs, and a generated GBP report;
 * - "unbound": added via Places search (no GBP), 1 rank run and a report showing gbp_not_connected.
 * Rank runs use the offline demo Places client; Place Details come from an offline demo client.
 * Prints the login, an access token and curl examples.
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
import { createDemoDetailsClient, writeDemoGbpData } from '../gbp/demo/demoGbp';
import { generateGbpReport } from '../gbp/report/generate';
import {
	GbpKeywordMonthly,
	GbpMetricDaily,
	GbpProfileSnapshot,
	GbpReport,
	GbpReview,
	GbpSync,
	ILocation,
	Location,
	Profile,
	RankRun,
	User,
	UserGBP,
	UserToken,
} from '../models';
import { DEMO_CENTER, DEMO_KEYWORDS, DEMO_PLACE_IDS, createDemoPlaces } from '../ranking/demo/demoPlaces';
import { generateAuthTokens } from '../services/common/token.service';
import { enqueueRankRun } from '../services/ranking/rankRun.service';
import { executeRankRun } from '../services/ranking/rankRunExecutor';
import { normaliseKeywords } from '../services/ranking/trackingSettings';

const DEMO_EMAIL = 'gbp-demo@mypageseo.test';
const REQUIRED_DB = 'mps_rebuild';
const DAY = 24 * 60 * 60 * 1000;

const out = (line = ''): void => {
	process.stdout.write(`${line}\n`);
};

const fail = (message: string): never => {
	process.stderr.write(`seed:gbp-demo refused: ${message}\n`);
	process.exit(1);
};

const removePreviousDemo = async (): Promise<void> => {
	const user = await User.findOne({ email: DEMO_EMAIL });
	if (!user) return;
	const ids = (await Location.find({ created_by: user._id }).select({ _id: 1 })).map((l) => l._id);
	const byLocation = { location_id: { $in: ids } };
	await Promise.all([
		RankRun.deleteMany(byLocation),
		GbpReport.deleteMany(byLocation),
		GbpSync.deleteMany(byLocation),
		GbpMetricDaily.deleteMany(byLocation),
		GbpKeywordMonthly.deleteMany(byLocation),
		GbpProfileSnapshot.deleteMany(byLocation),
		GbpReview.deleteMany(byLocation),
		UserGBP.deleteMany({ user_id: user._id }),
	]);
	await Location.deleteMany({ created_by: user._id });
	await Profile.deleteMany({ user_id: user._id });
	await UserToken.deleteMany({ user_id: user._id });
	await User.deleteOne({ _id: user._id });
};

const createDemoLocation = (userId: Types.ObjectId, name: string, now: number) =>
	Location.create({
		name,
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
		created_by: userId,
		tracking: {
			keywords: normaliseKeywords(DEMO_KEYWORDS, config.ranking.maxKeywords),
			keywords_version: 1,
			keywords_updated_at: new Date(now - 60 * DAY),
			competitors: [DEMO_PLACE_IDS.competitor_2],
			grid: { size: 5, spacing_km: 1 },
			frequency: 'auto_monthly',
			last_run_at: null,
			last_error: null,
		},
	});

/** Rank runs with the offline demo Places client (production limits: 3 keywords, 5×5). */
const runRanks = async (location: ILocation, userId: Types.ObjectId, runs: (0 | 1 | 2)[], now: number): Promise<void> => {
	const noSchedule = { schedule: async () => ({}) } as unknown as Agenda;
	for (const [i, run] of runs.entries()) {
		const runAt = new Date(now - (runs.length - 1 - i) * 30 * DAY - DAY);
		const fresh = (await Location.findOne({ _id: location._id })) as ILocation;
		const queued = await enqueueRankRun(fresh, userId, 'scheduled', { agenda: noSchedule, now: runAt, planOptions: { env: 'production' } });
		let calls = 0;
		await executeRankRun(queued.run_id, {
			places: createDemoPlaces(run),
			engine: { sleep: async () => undefined },
			now: () => new Date(runAt.getTime() + (calls++ === 0 ? 5 : 95) * 1000),
		});
	}
};

const main = async (): Promise<void> => {
	if (config.essentials.env !== 'development') fail(`NODE_ENV is "${config.essentials.env}", not "development"`);
	const v4 = !process.argv.includes('--v4-off');

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
	await Promise.all([RankRun.syncIndexes(), Location.syncIndexes(), GbpReport.syncIndexes(), GbpSync.syncIndexes(), UserGBP.syncIndexes()]);

	await removePreviousDemo();

	const password = randomBytes(9).toString('base64url');
	const user = await User.create({
		email: DEMO_EMAIL,
		password: bcrypt.hashSync(password, 10),
		role_id: config.roles.user,
		user_type: userTypes.business,
		status: userStatusTypes.ACCEPTED,
		is_gbp_connected: true,
	});
	await Profile.create({ user_id: user._id, name: 'GBP Demo', business_name: 'Maple Leaf Plumbing & Heating' });
	const userId = user._id as Types.ObjectId;

	const now = Date.now();
	const bound = await createDemoLocation(userId, 'Maple Leaf Plumbing & Heating', now);
	const unbound = await createDemoLocation(userId, 'Maple Leaf Plumbing & Heating (Places search, no GBP)', now);
	await runRanks(bound, userId, [0, 1, 2], now);
	await runRanks(unbound, userId, [2], now);
	await writeDemoGbpData({ _id: bound._id as Types.ObjectId }, userId, new Date(now));

	const places = createDemoDetailsClient();
	await generateGbpReport(String(bound._id), 'seed', { places, v4Enabled: v4, withEditorialSummary: false });
	await generateGbpReport(String(unbound._id), 'seed', { places, v4Enabled: false, withEditorialSummary: false });
	const report = await GbpReport.findOne({ location_id: bound._id }).lean();

	const tokens = await generateAuthTokens(user);
	const base = `http://localhost:${config.essentials.port}/api/v1/locations`;
	const score = report?.gbp_score && report.gbp_score.available ? `${report.gbp_score.score} (${report.gbp_score.grade}${report.gbp_score.partial ? ', partial' : ''})` : '-';

	out(`GBP demo data created in mps_rebuild (offline demo clients: 0 Google API calls; v4 sections ${v4 ? 'filled' : 'off'}).`);
	out();
	out(`  Login:        ${DEMO_EMAIL}`);
	out(`  Password:     ${password}`);
	out(`  Bound:        ${String(bound._id)}  (GBP Score ${score})`);
	out(`  Unbound:      ${String(unbound._id)}  (Places search: private sections gbp_not_connected)`);
	out(`  Access token: ${tokens.access.token}`);
	out(`  (expires ${tokens.access.expires.toISOString()})`);
	out();
	out('  Try:');
	out(`    TOKEN='${tokens.access.token}'`);
	out(`    curl -s -H "Authorization: Bearer $TOKEN" "${base}/${String(bound._id)}/gbp/report?range=28d"`);
	out(`    curl -s -H "Authorization: Bearer $TOKEN" "${base}/${String(bound._id)}/gbp/report?range=12m"`);
	out(`    curl -s -H "Authorization: Bearer $TOKEN" "${base}/${String(unbound._id)}/gbp/report"`);
	out(`    curl -s -H "Authorization: Bearer $TOKEN" ${base}/${String(bound._id)}/refresh`);

	await mongoose.disconnect();
	process.exit(0);
};

main().catch(async (err: Error) => {
	process.stderr.write(`seed:gbp-demo failed: ${err.message}\n`);
	await mongoose.disconnect().catch(() => undefined);
	process.exit(1);
});
