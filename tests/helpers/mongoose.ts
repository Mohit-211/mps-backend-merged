import mongoose, { Types } from 'mongoose';
import { DateTime } from 'luxon';
import config from '../../src/configs/config';
import { tokenTypes, userStatusTypes, userTypes } from '../../src/configs/constantTypes';
import { ILocation, ILocationTracking, IUser, Location, RankRun, User } from '../../src/models';
import { generateToken } from '../../src/services/common/token.service';
import { withDefaults } from '../../src/services/ranking/trackingSettings';
import { startMemoryMongo } from './memoryMongo';

// In-memory MongoDB for integration tests, with the indexes the ranking code relies on
// (e.g. the unique "one active run per location" index).

export const startTestDb = async (): Promise<{ stop: () => Promise<void> }> => {
	const server = await startMemoryMongo();
	await mongoose.connect(server.getUri(), { dbName: 'mps_test' });
	await Promise.all([RankRun.syncIndexes(), Location.syncIndexes()]);
	return {
		stop: async () => {
			await mongoose.disconnect();
			await server.stop();
		},
	};
};

export const clearDb = async (): Promise<void> => {
	const db = mongoose.connection.db;
	if (!db) return;
	for (const collection of await db.collections()) await collection.deleteMany({});
};

export const createUser = async (email: string): Promise<{ user: IUser; token: string }> => {
	const user = await User.create({
		email,
		password: 'not-used-in-tests',
		role_id: config.roles.user,
		user_type: userTypes.business,
		status: userStatusTypes.ACCEPTED,
	});
	const token = generateToken(
		user._id,
		DateTime.now().plus({ days: 1 }),
		tokenTypes.ACCESS,
		user.role_id,
		user.user_type as string,
	);
	return { user, token };
};

export const SELF_PLACE_ID = 'ChIJselfTestPlaceId000001';
export const COMPETITOR_1 = 'ChIJcompetitorTestId00001';
export const COMPETITOR_2 = 'ChIJcompetitorTestId00002';
export const TORONTO = { lat: 43.6629, lng: -79.3347 };

export const createLocation = async (
	userId: Types.ObjectId,
	overrides: Partial<{
		lat: number | null;
		lng: number | null;
		place_id: string | null;
		country: string;
		tracking: Partial<ILocationTracking>;
	}> = {},
): Promise<ILocation> =>
	Location.create({
		name: 'Maple Leaf Plumbing & Heating',
		address: '100 Queen St E',
		country: overrides.country ?? 'Canada',
		state: 'Ontario',
		city: 'Toronto',
		zip_code: 'M5C 1S6',
		mobile: '4165550100',
		website_URL: 'https://example.test',
		business_category: 'Plumber',
		place_id: overrides.place_id === undefined ? SELF_PLACE_ID : overrides.place_id,
		lat: overrides.lat === undefined ? TORONTO.lat : overrides.lat,
		lng: overrides.lng === undefined ? TORONTO.lng : overrides.lng,
		created_by: userId,
		tracking: overrides.tracking ? { ...withDefaults(null), ...overrides.tracking } : undefined,
	});

export const keywordsOf = (...texts: string[]): ILocationTracking['keywords'] =>
	texts.map((text) => ({ text, normalized: text.toLowerCase() }));
