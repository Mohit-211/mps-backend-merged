/*
 * Demo organizations for frontend work, with NO API key and NO network (Phase 8):
 *
 *   npm run seed:demo-orgs              (reviews, media and posts filled, as with GBP_V4_ENABLED=true)
 *   npm run seed:demo-orgs -- --v4-off  (the GBP report as it looks before v4 access)
 *   (`npm run seed:gbp-demo` is an alias)
 *
 * Creates (or recreates) in mps_rebuild:
 * - a Business organization (business-demo@mypageseo.test): 1 GBP-connected location with 3 monthly
 *   rank runs, 18 months of GBP data and a GBP report;
 * - an Agency organization (agency-demo@mypageseo.test) on a demo plan (5 locations): 2 clients and 3
 *   locations (2 GBP-connected, 1 added from a Places search: gbp_not_connected), each with rank runs
 *   and a report; plus a client user (agency-client@mypageseo.test) who sees one client only.
 * Rank runs use the offline demo Places client; Place Details come from an offline demo client.
 * Prints logins, tokens and curl examples.
 *
 * Refuses to run unless NODE_ENV=development AND the connected database is mps_rebuild.
 * Only the demo accounts' own data (and the demo plan) are deleted and recreated.
 */
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import mongoose, { Types } from 'mongoose';
import { Agenda } from 'agenda';
import config from '../configs/config';
import { tokenTypes, userStatusTypes, userTypes } from '../configs/constantTypes';
import { createDemoDetailsClient, writeDemoGbpData } from '../gbp/demo/demoGbp';
import { generateGbpReport } from '../gbp/report/generate';
import {
	Client,
	GbpKeywordMonthly,
	GbpMetricDaily,
	GbpProfileSnapshot,
	GbpReport,
	GbpReview,
	GbpSync,
	ILocation,
	IUser,
	Location,
	Membership,
	Organization,
	Profile,
	RankRun,
	SubscriptionPlan,
	User,
	UserAuth,
	UserGBP,
	UserToken,
} from '../models';
import { DEMO_CENTER, DEMO_KEYWORDS, DEMO_PLACE_IDS, createDemoPlaces } from '../ranking/demo/demoPlaces';
import { generateAuthTokens } from '../services/common/token.service';
import { updateSummaryFromRuns } from '../services/locations/summary';
import { createOrganizationForOwner } from '../services/org/context';
import { enqueueRankRun } from '../services/ranking/rankRun.service';
import { executeRankRun } from '../services/ranking/rankRunExecutor';
import { normaliseKeywords } from '../services/ranking/trackingSettings';

const BUSINESS_EMAIL = 'business-demo@mypageseo.test';
const AGENCY_EMAIL = 'agency-demo@mypageseo.test';
const CLIENT_USER_EMAIL = 'agency-client@mypageseo.test';
/** Earlier demo accounts (seed:gbp-demo before Phase 8) are cleaned up too. */
const OLD_EMAILS = ['gbp-demo@mypageseo.test'];
const DEMO_PLAN = 'Demo Agency (seed)';
const REQUIRED_DB = 'mps_rebuild';
const DAY = 24 * 60 * 60 * 1000;

const out = (line = ''): void => {
	process.stdout.write(`${line}\n`);
};

const fail = (message: string): never => {
	process.stderr.write(`seed:demo-orgs refused: ${message}\n`);
	process.exit(1);
};

const removePreviousDemo = async (): Promise<void> => {
	const users = await User.find({ email: { $in: [BUSINESS_EMAIL, AGENCY_EMAIL, CLIENT_USER_EMAIL, ...OLD_EMAILS] } }).select({ _id: 1 }).lean();
	const userIds = users.map((u) => u._id);
	const orgIds = (await Organization.find({ owner_user_id: { $in: userIds } }).select({ _id: 1 }).lean()).map((o) => o._id);
	const ids = (
		await Location.find({ $or: [{ created_by: { $in: userIds } }, { organization_id: { $in: orgIds } }] })
			.setOptions({ strictQuery: false })
			.select({ _id: 1 })
			.lean()
	).map((l) => l._id);
	await Location.collection.deleteMany({ $or: [{ created_by: { $in: userIds } }, { organization_id: { $in: orgIds } }] });
	const byLocation = { location_id: { $in: ids } };
	await Promise.all([
		RankRun.deleteMany(byLocation),
		GbpReport.deleteMany(byLocation),
		GbpSync.deleteMany(byLocation),
		GbpMetricDaily.deleteMany(byLocation),
		GbpKeywordMonthly.deleteMany(byLocation),
		GbpProfileSnapshot.deleteMany(byLocation),
		GbpReview.deleteMany(byLocation),
		UserGBP.deleteMany({ $or: [{ user_id: { $in: userIds } }, byLocation] }),
		Client.collection.deleteMany({ organization_id: { $in: orgIds } }),
		Membership.deleteMany({ $or: [{ organization_id: { $in: orgIds } }, { user_id: { $in: userIds } }] }),
		Organization.deleteMany({ _id: { $in: orgIds } }),
		Profile.deleteMany({ user_id: { $in: userIds } }),
		UserToken.deleteMany({ user_id: { $in: userIds } }),
		UserAuth.deleteMany({ user_id: { $in: userIds } }),
		SubscriptionPlan.deleteMany({ name: DEMO_PLAN }),
	]);
	await User.deleteMany({ _id: { $in: userIds } });
};

const createDemoUser = async (email: string, name: string, type: string, password: string): Promise<IUser> => {
	const user = await User.create({
		email,
		password: bcrypt.hashSync(password, 10),
		role_id: config.roles.user,
		user_type: type,
		status: userStatusTypes.ACCEPTED,
	});
	await Profile.create({ user_id: user._id, name, business_name: name });
	return user;
};

interface DemoLocationInput {
	name: string;
	placeId: string;
	competitors: string[];
	source: 'gbp' | 'places_search';
	clientId?: Types.ObjectId | null;
}

const createDemoLocation = (orgId: Types.ObjectId, userId: Types.ObjectId, input: DemoLocationInput, now: number) =>
	Location.create({
		name: input.name,
		address: '100 Queen St E',
		country: 'Canada',
		state: 'ON',
		city: 'Toronto',
		zip_code: 'M5C 1S6',
		mobile: '4165550100',
		website_URL: 'https://mapleleafplumbing.example',
		business_category: 'Plumber',
		place_id: input.placeId,
		lat: DEMO_CENTER.lat,
		lng: DEMO_CENTER.lng,
		center_source: 'place_details',
		organization_id: orgId,
		client_id: input.clientId ?? null,
		source: input.source,
		gbp_connected: false,
		created_by: userId,
		onboarding: { step: 'completed', started_at: new Date(now - 95 * DAY), completed_at: new Date(now - 90 * DAY) },
		refresh: { anchor_day: new Date(now - 90 * DAY).getUTCDate() > 28 ? 28 : new Date(now - 90 * DAY).getUTCDate(), next_refresh_at: new Date(now + 20 * DAY), last_auto_refresh_at: new Date(now - 10 * DAY), last_manual: { rankings: null, gbp: null } },
		tracking: {
			keywords: normaliseKeywords(DEMO_KEYWORDS, config.ranking.maxKeywords),
			keywords_version: 1,
			keywords_updated_at: new Date(now - 90 * DAY),
			competitors: input.competitors,
			grid: { size: 5, spacing_km: 1 },
			frequency: 'auto_monthly',
			last_run_at: null,
			last_error: null,
		},
	});

/**
 * A placeholder Google connection for the demo bindings (status active; the token values are not real
 * and are never used: the demo never syncs). Without it the demo locations would show reconnect_required.
 */
const demoConnection = (userId: Types.ObjectId) =>
	UserAuth.collection.insertOne({
		user_id: userId,
		token_type: tokenTypes.GBP,
		access_token: 'demo-placeholder',
		refresh_token: 'demo-placeholder',
		expiry_date: new Date('2099-01-01T00:00:00Z'),
		status: 'active',
		google_email: 'demo@mypageseo.test',
		google_sub: 'demo-google-sub',
		is_active: true,
		created_at: new Date(),
		updated_at: new Date(),
		deleted_at: null,
	});

/** Monthly rank runs with the offline demo Places client (production limits: 3 keywords, 5×5). */
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
	await updateSummaryFromRuns(location._id as Types.ObjectId);
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
	await Promise.all([
		RankRun.syncIndexes(),
		Location.syncIndexes(),
		GbpReport.syncIndexes(),
		GbpSync.syncIndexes(),
		UserGBP.syncIndexes(),
		Organization.syncIndexes(),
		Membership.syncIndexes(),
	]);

	await removePreviousDemo();
	const now = Date.now();
	const places = createDemoDetailsClient();
	const password = randomBytes(9).toString('base64url');

	// ---- Business organization: 1 GBP-connected location ----
	const business = await createDemoUser(BUSINESS_EMAIL, 'Maple Leaf Plumbing & Heating', userTypes.business, password);
	const businessOrg = await createOrganizationForOwner(business._id, { name: 'Maple Leaf Plumbing & Heating', type: 'business', country: 'CA' });
	const bLoc = await createDemoLocation(
		businessOrg._id as Types.ObjectId,
		business._id,
		{ name: 'Maple Leaf Plumbing & Heating', placeId: DEMO_PLACE_IDS.self, competitors: [DEMO_PLACE_IDS.competitor_2], source: 'gbp' },
		now,
	);
	await runRanks(bLoc, business._id, [0, 1, 2], now);
	await writeDemoGbpData({ _id: bLoc._id as Types.ObjectId }, business._id, new Date(now));
	await demoConnection(business._id);
	await generateGbpReport(String(bLoc._id), 'seed', { places, v4Enabled: v4, withEditorialSummary: false });

	// ---- Agency organization: 2 clients, 3 locations, a client user, a demo plan ----
	const agency = await createDemoUser(AGENCY_EMAIL, 'Northern Local SEO', userTypes.agency, password);
	const plan = await SubscriptionPlan.create({ name: DEMO_PLAN, country: 'CANADA', currency: 'CAD', monthly_price: 0, location_limit: 5, keyword_limit: 60 });
	await User.updateOne({ _id: agency._id }, { $set: { subscription_status: 'ACTIVE', current_plan_id: plan._id } });
	const agencyOrg = await createOrganizationForOwner(agency._id, { name: 'Northern Local SEO', type: 'agency', country: 'CA' });
	const orgId = agencyOrg._id as Types.ObjectId;
	const clientA = await Client.create({ company_name: 'Maple Leaf Group', company_URL: 'https://mapleleafgroup.example', contact_email: 'owner@mapleleafgroup.example', organization_id: orgId, created_by: agency._id });
	const clientB = await Client.create({ company_name: 'Danforth Services', company_URL: 'https://danforth.example', organization_id: orgId, created_by: agency._id });

	const a1 = await createDemoLocation(
		orgId,
		agency._id,
		{ name: 'Maple Leaf Plumbing & Heating', placeId: DEMO_PLACE_IDS.self, competitors: [DEMO_PLACE_IDS.competitor_2], source: 'gbp', clientId: clientA._id as Types.ObjectId },
		now,
	);
	const a2 = await createDemoLocation(
		orgId,
		agency._id,
		{ name: 'Queen West Plumbing Co.', placeId: DEMO_PLACE_IDS.competitor_1, competitors: [DEMO_PLACE_IDS.self], source: 'gbp', clientId: clientA._id as Types.ObjectId },
		now,
	);
	const a3 = await createDemoLocation(
		orgId,
		agency._id,
		{ name: 'Danforth Drain Pros', placeId: DEMO_PLACE_IDS.competitor_2, competitors: [DEMO_PLACE_IDS.self], source: 'places_search', clientId: clientB._id as Types.ObjectId },
		now,
	);
	for (const loc of [a1, a2, a3]) await runRanks(loc, agency._id, [1, 2], now);
	await writeDemoGbpData({ _id: a1._id as Types.ObjectId }, agency._id, new Date(now), { gbpLocationId: 'locations/demo-a1' });
	await writeDemoGbpData({ _id: a2._id as Types.ObjectId }, agency._id, new Date(now), {
		gbpLocationId: 'locations/demo-a2',
		placeId: DEMO_PLACE_IDS.competitor_1,
		title: 'Queen West Plumbing Co.',
	});
	await demoConnection(agency._id);
	for (const loc of [a1, a2, a3]) await generateGbpReport(String(loc._id), 'seed', { places, v4Enabled: v4, withEditorialSummary: false });

	const clientUser = await createDemoUser(CLIENT_USER_EMAIL, 'Danforth Services (client)', userTypes.client, password);
	await Membership.create({ organization_id: orgId, user_id: clientUser._id, role: 'client_user', client_ids: [clientB._id], created_by: agency._id });
	await User.updateOne({ _id: clientUser._id }, { $set: { default_organization_id: orgId } });
	await Organization.updateMany({ _id: { $in: [businessOrg._id, orgId] } }, { $set: { 'onboarding.completed_at': new Date(now - 90 * DAY), 'onboarding.skipped': ['reporting_brand'] } });

	const tokenOf = async (user: IUser) => (await generateAuthTokens(user)).access.token as string;
	const base = `http://localhost:${config.essentials.port}/api/v1`;
	out(`Demo organizations created in mps_rebuild (offline demo clients: 0 Google API calls; v4 sections ${v4 ? 'filled' : 'off'}).`);
	out(`Password for all demo accounts: ${password}`);
	out();
	out(`Business: ${BUSINESS_EMAIL}  organization ${String(businessOrg._id)}  location ${String(bLoc._id)}`);
	out(`  TOKEN_BUSINESS='${await tokenOf(business)}'`);
	out(`Agency:   ${AGENCY_EMAIL}  organization ${String(orgId)} (plan: 5 locations)`);
	out(`  clients: Maple Leaf Group ${String(clientA._id)}, Danforth Services ${String(clientB._id)}`);
	out(`  locations: ${String(a1._id)} (GBP), ${String(a2._id)} (GBP), ${String(a3._id)} (Places search: gbp_not_connected)`);
	out(`  TOKEN_AGENCY='${await tokenOf(agency)}'`);
	out(`Client user: ${CLIENT_USER_EMAIL}  (sees Danforth Services only, read-only)`);
	out(`  TOKEN_CLIENT='${await tokenOf(clientUser)}'`);
	out();
	out('  Try:');
	out(`    curl -s -H "Authorization: Bearer $TOKEN_AGENCY" "${base}/locations?sort=rank"`);
	out(`    curl -s -H "Authorization: Bearer $TOKEN_AGENCY" ${base}/organization/usage`);
	out(`    curl -s -H "Authorization: Bearer $TOKEN_AGENCY" ${base}/clients/${String(clientA._id)}`);
	out(`    curl -s -H "Authorization: Bearer $TOKEN_AGENCY" ${base}/locations/${String(a1._id)}/overview`);
	out(`    curl -s -H "Authorization: Bearer $TOKEN_BUSINESS" "${base}/locations/${String(bLoc._id)}/gbp/report?range=28d"`);
	out(`    curl -s -H "Authorization: Bearer $TOKEN_CLIENT" ${base}/locations`);

	await mongoose.disconnect();
	process.exit(0);
};

main().catch(async (err: Error) => {
	process.stderr.write(`seed:demo-orgs failed: ${err.message}\n`);
	await mongoose.disconnect().catch(() => undefined);
	process.exit(1);
});
