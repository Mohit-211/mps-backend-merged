import mongoose, { Types } from 'mongoose';
import { DateTime } from 'luxon';
import config from '../../src/configs/config';
import { tokenTypes, userStatusTypes, userTypes } from '../../src/configs/constantTypes';
import { ILocation, ILocationTracking, IOrganization, IUser, Location, Membership, MembershipRole, Organization, RankRun, User } from '../../src/models';
import { generateToken } from '../../src/services/common/token.service';
import { withDefaults } from '../../src/services/ranking/trackingSettings';
import { startMemoryMongo } from './memoryMongo';

// In-memory MongoDB for integration tests, with the indexes the ranking code relies on
// (e.g. the unique "one active run per location" index).

export const startTestDb = async (): Promise<{ stop: () => Promise<void> }> => {
	const server = await startMemoryMongo();
	await mongoose.connect(server.getUri(), { dbName: 'mps_test' });
	await Promise.all([RankRun.syncIndexes(), Location.syncIndexes(), Membership.syncIndexes()]);
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

/** The organization the user owns, created on first use (Phase 8: locations belong to an organization). */
export const ensureOrg = async (userId: Types.ObjectId | string, type: IOrganization['type'] = 'business'): Promise<IOrganization> => {
	const owned = await Organization.findOne({ owner_user_id: userId });
	if (owned) return owned;
	const org = await Organization.create({ name: `Org ${String(userId).slice(-6)}`, type, country: 'CA', owner_user_id: userId });
	await Membership.create({ organization_id: org._id, user_id: userId, role: 'owner' });
	await User.updateOne({ _id: userId }, { $set: { default_organization_id: org._id } });
	return org;
};

/** Adds a user to an organization with a role (client_user: the clients it may see). */
export const addMember = async (organizationId: Types.ObjectId | string, userId: Types.ObjectId | string, role: MembershipRole, clientIds: Types.ObjectId[] = []) =>
	Membership.create({ organization_id: organizationId, user_id: userId, role, client_ids: clientIds });

let placeCounter = 0;

export const createLocation = async (
	userId: Types.ObjectId,
	overrides: Partial<{
		lat: number | null;
		lng: number | null;
		place_id: string | null;
		country: string;
		tracking: Partial<ILocationTracking>;
		organization_id: Types.ObjectId;
		client_id: Types.ObjectId | null;
		name: string;
	}> = {},
): Promise<ILocation> => {
	const organizationId = overrides.organization_id ?? (await ensureOrg(userId))._id;
	// One active location per place_id per organization (Phase 8): later default locations get their own id.
	let placeId = overrides.place_id === undefined ? SELF_PLACE_ID : overrides.place_id;
	if (overrides.place_id === undefined && (await Location.exists({ organization_id: organizationId, place_id: SELF_PLACE_ID, is_active: true }))) {
		placeId = `ChIJextraTestPlace${String(++placeCounter).padStart(7, "0")}`;
	}
	return Location.create({
		organization_id: organizationId,
		client_id: overrides.client_id ?? null,
		name: overrides.name ?? 'Maple Leaf Plumbing & Heating',
		address: '100 Queen St E',
		country: overrides.country ?? 'Canada',
		state: 'Ontario',
		city: 'Toronto',
		zip_code: 'M5C 1S6',
		mobile: '4165550100',
		website_URL: 'https://example.test',
		business_category: 'Plumber',
		place_id: placeId,
		lat: overrides.lat === undefined ? TORONTO.lat : overrides.lat,
		lng: overrides.lng === undefined ? TORONTO.lng : overrides.lng,
		created_by: userId,
		tracking: overrides.tracking ? { ...withDefaults(null), ...overrides.tracking } : undefined,
	});
};

export const keywordsOf = (...texts: string[]): ILocationTracking['keywords'] =>
	texts.map((text) => ({ text, normalized: text.toLowerCase() }));
