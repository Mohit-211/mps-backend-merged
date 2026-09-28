import { BillingPlan, Coupon, Organization, Payment, Subscription } from '../../../src/models';
import { migrateBilling } from '../../../src/services/billing/migrate';
import { clearDb, createUser, ensureOrg, startTestDb } from '../../helpers/mongoose';

jest.setTimeout(60000);

let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
});
afterAll(async () => db.stop());
beforeEach(clearDb);

describe('migrate:billing', () => {
	it('dry run changes nothing; apply links by verified email, starts trials, deactivates legacy coupons; re-run is a no-op', async () => {
		const now = new Date('2026-10-01T00:00:00Z');
		const { user } = await createUser('paid@test.dev');
		const paidOrg = await ensureOrg(user._id);
		const other = await createUser('free@test.dev');
		const freeOrg = await ensureOrg(other.user._id);
		await Organization.updateMany({}, { $unset: { trial_ends_at: 1 } });
		await Payment.collection.insertMany([
			{ paypal_subscription_id: 'I-OK', customer_email: 'PAID@test.dev', status: 'SUCCESS', subscription_status: 'active', monthly_amount: 79, is_active: true },
			{ paypal_subscription_id: 'I-NOBODY', customer_email: 'nobody@test.dev', status: 'SUCCESS', subscription_status: 'active', is_active: true },
			{ paypal_subscription_id: 'I-ENDED', customer_email: 'paid@test.dev', status: 'SUCCESS', subscription_status: 'cancelled', is_active: true },
		]);
		await Coupon.collection.insertOne({ code: 'OLD50', plan_id: null, original_amount: 100, discount_amount: 50, final_amount: 50, expires_at: new Date('2027-01-01'), is_used: false, is_active: true });

		const dry = await migrateBilling({ apply: false, now });
		expect(dry).toMatchObject({ standard_plan: 'would_create', trials_started: 2, coupons_deactivated: 1 });
		expect(dry.legacy.linked).toHaveLength(1);
		expect(dry.legacy.unmatched).toEqual([expect.objectContaining({ email: 'nobody@test.dev' })]);
		expect(await Subscription.countDocuments()).toBe(0);
		expect(await BillingPlan.countDocuments()).toBe(0);

		const applied = await migrateBilling({ apply: true, now });
		expect(applied).toMatchObject({ standard_plan: 'created', trials_started: 2, coupons_deactivated: 1 });
		expect(await Subscription.findOne({ provider_subscription_id: 'I-OK' }).lean()).toMatchObject({ organization_id: paidOrg._id, status: 'active', price: { first: 79, additional: 0 } });
		expect((await Organization.findById(freeOrg._id).lean())?.trial_ends_at?.toISOString()).toBe('2026-10-08T00:00:00.000Z');
		expect(await Coupon.findOne({ code: 'OLD50' }).lean()).toMatchObject({ is_active: false, discount_type: 'fixed', value: 50 });

		const again = await migrateBilling({ apply: true, now });
		expect(again).toMatchObject({ standard_plan: 'exists', trials_started: 0, coupons_deactivated: 0, legacy: { already_linked: 1, linked: [] } });
	});
});
