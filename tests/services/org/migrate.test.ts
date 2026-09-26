import { Types } from 'mongoose';
import { Client, Location, Membership, Organization, Profile, User, UserGBP } from '../../../src/models';
import { migrateOrganizations } from '../../../src/services/org/migrate';
import { clearDb, createUser, startTestDb } from '../../helpers/mongoose';

jest.mock('../../../src/configs/mongoConnection', () => ({ agenda: {} }));

let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
}, 60000);
afterAll(async () => db.stop());
beforeEach(async () => clearDb());

/** A pre-Phase 8 location: created_by only, no organization. */
const legacyLocation = (createdBy: Types.ObjectId | null, placeId: string) =>
	Location.collection.insertOne({
		name: 'Legacy',
		address: 'x',
		country: 'Canada',
		state: 'NB',
		city: 'Fredericton',
		zip_code: 'x',
		mobile: 'x',
		website_URL: 'x',
		business_category: 'x',
		place_id: placeId,
		created_by: createdBy,
		is_active: true,
		deleted_at: null,
	});

describe('migrateOrganizations', () => {
	it('maps agency, business, untyped, employee and client accounts; assigns locations and clients; is idempotent', async () => {
		const { user: agency } = await createUser('agency@test.dev');
		await User.updateOne({ _id: agency._id }, { $set: { user_type: 'AGENCY' } });
		await Profile.create({ user_id: agency._id, name: 'Ann', business_name: 'Ann Agency', country: 'United States' });
		const { user: untyped } = await createUser('live@test.dev');
		await User.updateOne({ _id: untyped._id }, { $set: { user_type: null } });
		await Profile.create({ user_id: untyped._id, name: 'MyPageSEO', country: 'Canada' });
		const { user: employee } = await createUser('emp@test.dev');
		await User.updateOne({ _id: employee._id }, { $set: { user_type: 'EMPLOYEE', owner_id: agency._id } });
		const { user: client } = await createUser('client@test.dev');
		await User.updateOne({ _id: client._id }, { $set: { user_type: 'CLIENT' } });

		const bound = await legacyLocation(agency._id as Types.ObjectId, 'ChIJaaa0000000000000000001');
		await legacyLocation(employee._id as Types.ObjectId, 'ChIJbbb0000000000000000001'); // employee-created → the agency
		const first = await legacyLocation(untyped._id as Types.ObjectId, 'ChIJccc0000000000000000001');
		const dup = await legacyLocation(untyped._id as Types.ObjectId, 'ChIJccc0000000000000000001'); // duplicate: left unassigned
		const orphan = await legacyLocation(null, 'ChIJddd0000000000000000001');
		await UserGBP.create({ user_id: agency._id, location_id: bound.insertedId, gbpAccountId: 'accounts/1', gbpLocationId: 'locations/1' });
		await Client.create({ company_name: 'C', created_by: agency._id });

		const report = await migrateOrganizations();
		expect(report.organizations_created).toBe(2);
		const byUser = new Map(report.users.map((r) => [r.user_id, r]));
		expect(byUser.get(String(agency._id))).toMatchObject({ role: 'owner', organization: { name: 'Ann Agency', type: 'agency', created: true } });
		expect(byUser.get(String(untyped._id))).toMatchObject({ role: 'owner', organization: { name: 'MyPageSEO', type: 'business' } });
		expect(byUser.get(String(employee._id))).toMatchObject({ role: 'member', organization: { name: 'Ann Agency' } });
		expect(byUser.get(String(client._id))).toMatchObject({ organization: null, note: 'CLIENT account: skipped' });

		const agencyOrg = await Organization.findOne({ owner_user_id: agency._id }).lean();
		expect(agencyOrg).toMatchObject({ country: 'US' });
		expect(await Membership.countDocuments({ organization_id: agencyOrg?._id })).toBe(2);
		expect(await Location.countDocuments({ organization_id: agencyOrg?._id })).toBe(2);
		expect(await Location.findById(bound.insertedId).lean()).toMatchObject({ source: 'gbp', gbp_connected: true });
		expect(await Client.countDocuments({ organization_id: agencyOrg?._id })).toBe(1);
		expect(report.locations_without_owner).toEqual([String(orphan.insertedId)]);
		expect(report.duplicates).toEqual([
			{ organization_id: expect.any(String), place_id: 'ChIJccc0000000000000000001', location_ids: [String(first.insertedId), String(dup.insertedId)] },
		]);
		expect((await Location.findById(dup.insertedId).lean())?.organization_id ?? null).toBeNull();
		expect(String((await User.findById(employee._id).lean())?.default_organization_id)).toBe(String(agencyOrg?._id));

		const again = await migrateOrganizations();
		expect(again).toMatchObject({ organizations_created: 0, memberships_created: 0, locations_assigned: 0, clients_assigned: 0 });
		expect(again.duplicates).toHaveLength(1);
		expect(await Organization.countDocuments()).toBe(2);
	});
});
