/*
 * Creates the live-test user + location for a real ranking run (docs/LIVE_TEST.md). No API calls.
 *
 *   npm run setup:live-test -- --name "MyPageSEO" --city Fredericton --state NB --country Canada \
 *     --place-id <id> --lat <lat> --lng <lng> --address "<formatted address>" \
 *     --keywords "seo company,digital marketing agency" --token-file <path>
 *
 * The location gets place_id and lat/lng directly (avoiding the legacy POST /locations, which makes an
 * all-fields Place Details call) and tracking: the keywords, a 3×3 grid at 1 km, frequency manual.
 * The access token is written to --token-file (mode 600), never printed.
 * Refuses unless NODE_ENV=development AND the database is mps_rebuild. Recreates only its own user.
 */
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import mongoose from 'mongoose';
import config from '../configs/config';
import { userStatusTypes, userTypes } from '../configs/constantTypes';
import { Location, Profile, RankRun, User, UserToken } from '../models';
import { generateAuthTokens } from '../services/common/token.service';
import { normaliseKeywords } from '../services/ranking/trackingSettings';

const EMAIL = 'live-test@mypageseo.test';

const arg = (name: string): string | undefined => {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : undefined;
};

const fail = (message: string): never => {
	process.stderr.write(`setup:live-test refused: ${message}\n`);
	process.exit(1);
};

const main = async (): Promise<void> => {
	if (config.essentials.env !== 'development') fail(`NODE_ENV is "${config.essentials.env}", not "development"`);
	const placeId = arg('place-id');
	const lat = Number(arg('lat'));
	const lng = Number(arg('lng'));
	const tokenFile = arg('token-file');
	const keywords = (arg('keywords') ?? '').split(',').map((k) => k.trim()).filter(Boolean);
	if (!placeId || !Number.isFinite(lat) || !Number.isFinite(lng) || !tokenFile || keywords.length === 0) {
		fail('required: --place-id --lat --lng --keywords --token-file');
	}

	await mongoose.connect(config.databases.mongodb.url, {
		user: config.databases.mongodb.user,
		pass: config.databases.mongodb.password,
		authSource: config.databases.mongodb.authSource,
		serverSelectionTimeoutMS: 10000,
	});
	if (mongoose.connection.db?.databaseName !== 'mps_rebuild') {
		await mongoose.disconnect();
		fail(`connected database is "${mongoose.connection.db?.databaseName}", not "mps_rebuild"`);
	}

	const previous = await User.findOne({ email: EMAIL });
	if (previous) {
		const locations = await Location.find({ created_by: previous._id }).select({ _id: 1 });
		await RankRun.deleteMany({ location_id: { $in: locations.map((l) => l._id) } });
		await Location.deleteMany({ created_by: previous._id });
		await Profile.deleteMany({ user_id: previous._id });
		await UserToken.deleteMany({ user_id: previous._id });
		await User.deleteOne({ _id: previous._id });
	}

	const user = await User.create({
		email: EMAIL,
		password: bcrypt.hashSync(randomBytes(12).toString('base64url'), 10),
		role_id: config.roles.user,
		user_type: userTypes.business,
		status: userStatusTypes.ACCEPTED,
	});
	await Profile.create({ user_id: user._id, name: 'Live Test' });
	const location = await Location.create({
		name: arg('name') ?? 'MyPageSEO',
		address: arg('address') ?? 'unknown',
		city: arg('city') ?? 'Fredericton',
		state: arg('state') ?? 'NB',
		country: arg('country') ?? 'Canada',
		zip_code: arg('zip') ?? 'n/a',
		mobile: 'n/a',
		website_URL: 'https://mypageseo.com',
		business_category: 'Marketing agency',
		place_id: placeId,
		lat,
		lng,
		created_by: user._id,
		tracking: {
			keywords: normaliseKeywords(keywords, config.ranking.maxKeywords),
			keywords_version: 1,
			keywords_updated_at: new Date(),
			competitors: [],
			grid: { size: 3, spacing_km: 1 },
			frequency: 'manual',
			next_run_at: null,
			last_run_at: null,
			last_error: null,
		},
	});

	const tokens = await generateAuthTokens(user);
	fs.writeFileSync(tokenFile as string, tokens.access.token, { mode: 0o600 });
	process.stdout.write(
		[
			`Live-test user:  ${EMAIL} (password not needed; token written to ${tokenFile})`,
			`Location id:     ${String(location._id)}`,
			`Place ID:        ${placeId}`,
			`Center:          ${lat}, ${lng}`,
			`Tracking:        ${keywords.join(' / ')}; grid 3x3 @ 1 km; frequency manual`,
		].join('\n') + '\n',
	);
	await mongoose.disconnect();
	process.exit(0);
};

main().catch(async (err: Error) => {
	process.stderr.write(`setup:live-test failed: ${err.message}\n`);
	await mongoose.disconnect().catch(() => undefined);
	process.exit(1);
});
