import bcrypt from 'bcryptjs';
import { Types } from 'mongoose';
import config from '../../../src/configs/config';
import { Admin, BillingPlan, BusinessCategory, City, Country, Directory, Organization, Role, State, Timezone } from '../../../src/models';
import { DatabaseNotEmptyError, setupFresh } from '../../../src/services/setup/setupFresh';
import { ensureSuperAdmin } from '../../../src/services/setup/superAdmin';
import { clearDb, startTestDb } from '../../helpers/mongoose';

// Phase 13b: setup:fresh on an empty in-memory database, with the real dumps/ and citation seed data.

jest.setTimeout(180000);

let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
});
afterAll(async () => db.stop());
beforeEach(clearDb);

describe('setup:fresh', () => {
	it('sets up an empty database in order, and a second run inserts nothing', async () => {
		const first = await setupFresh({ superAdmin: { email: 'Owner@Example.com', password: null } });
		expect(first.indexes).toBeGreaterThan(40);
		expect(first.reference_data.roles).toBeGreaterThan(0);
		expect(first.reference_data.cities).toBeGreaterThan(30000);
		expect(first.billing_plan).toMatchObject({ created: true, prices: 0 });
		expect(first.citations.directories_created).toBe(50);
		expect(first.super_admin).toMatchObject({ created: true, email: 'owner@example.com' });
		const password = first.super_admin.generated_password as string;
		expect(password.length).toBeGreaterThanOrEqual(20);
		const admin = await Admin.findOne({ email: 'owner@example.com' }).lean();
		expect(admin?.role_id).toBe(config.roles.superAdmin);
		expect(bcrypt.compareSync(password, admin?.password as string)).toBe(true);
		expect(await Role.exists({ role_id: config.roles.superAdmin })).toBeTruthy();
		expect(await Country.exists({ iso3: 'CAN' })).toBeTruthy();
		expect(await State.exists({ country_code: 'CAN', state_code: 'ON' })).toBeTruthy();
		expect((await City.findOne({ country_code: 'CAN' }).lean())?.state_id).toBeTruthy();
		expect(await BillingPlan.countDocuments({ kind: 'standard' })).toBe(1);

		const counts = async () => [await Country.countDocuments(), await State.countDocuments(), await City.countDocuments(), await Timezone.countDocuments(), await BusinessCategory.countDocuments(), await Directory.countDocuments(), await Admin.countDocuments()];
		const before = await counts();
		const second = await setupFresh({ superAdmin: { email: 'someone@else.com' } });
		expect(Object.values(second.reference_data).every((n) => n === 0)).toBe(true);
		expect(second.billing_plan.created).toBe(false);
		expect(second.super_admin).toEqual({ created: false, email: 'owner@example.com', generated_password: null });
		expect(await counts()).toEqual(before);
	});

	it('refuses a database with organizations unless forced', async () => {
		await Organization.create({ name: 'Existing', type: 'business', country: 'US', owner_user_id: new Types.ObjectId() });
		await expect(setupFresh({ superAdmin: { email: 'a@b.co' } })).rejects.toBeInstanceOf(DatabaseNotEmptyError);
		expect(await BillingPlan.countDocuments()).toBe(0);
	});
});

describe('ensureSuperAdmin', () => {
	it('uses a given password (≥ 12 characters) and needs a valid email', async () => {
		await expect(ensureSuperAdmin({ email: 'not-an-email' })).rejects.toThrow('email');
		await expect(ensureSuperAdmin({ email: 'a@b.co', password: 'short' })).rejects.toThrow('12');
		const r = await ensureSuperAdmin({ email: 'a@b.co', password: 'a-long-Password-1' });
		expect(r).toEqual({ created: true, email: 'a@b.co', generated_password: null });
	});
});
