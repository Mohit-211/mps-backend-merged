import { Types } from 'mongoose';
import { BillingPlan, Coupon, IOrganization, Organization, Subscription } from '../../models';
import { LegacyPaymentRow, linkLegacyPayment, listLegacyPayments, organizationForEmail } from './legacy';
import { standardPlan } from './plans';

// migrate:billing (Phase 13a). Dry run unless apply is set. Idempotent.
// 1. The standard plan (created without prices: Mohit sets them before launch).
// 2. Paid legacy guest-checkout subscriptions → linked to the organization owned by the verified user
//    with the payment's email; the others are reported for the admin link endpoint.
// 3. Every organization without a trial end gets one: now + the standard trial length.
// 4. Legacy per-plan coupons are converted to the new shape and deactivated (coupons are token-pack only).

export interface BillingMigrationReport {
	apply: boolean;
	standard_plan: 'exists' | 'created' | 'would_create';
	legacy: { linked: { payment_id: string; organization_id: string }[]; already_linked: number; unmatched: { payment_id: string; email: string | null; reason: string }[] };
	trials_started: number;
	coupons_deactivated: number;
}

export const migrateBilling = async (opts: { apply: boolean; now?: Date }): Promise<BillingMigrationReport> => {
	const now = opts.now ?? new Date();
	const report: BillingMigrationReport = { apply: opts.apply, standard_plan: 'exists', legacy: { linked: [], already_linked: 0, unmatched: [] }, trials_started: 0, coupons_deactivated: 0 };

	const existing = await BillingPlan.exists({ kind: 'standard' });
	if (!existing) report.standard_plan = opts.apply ? 'created' : 'would_create';
	const plan = opts.apply ? await standardPlan() : ((await BillingPlan.findOne({ kind: 'standard' }).lean()) ?? { trial: { days: 7 } });

	const rows: LegacyPaymentRow[] = await listLegacyPayments();
	for (const row of rows) {
		const pid = String(row._id);
		if (await Subscription.exists({ provider_subscription_id: row.paypal_subscription_id })) {
			report.legacy.already_linked += 1;
			continue;
		}
		const org: IOrganization | null = await organizationForEmail(row.customer_email);
		if (!org) {
			report.legacy.unmatched.push({ payment_id: pid, email: row.customer_email ?? null, reason: 'no single organization owned by a verified user with this email' });
			continue;
		}
		if (await Subscription.exists({ organization_id: org._id, open: true })) {
			report.legacy.unmatched.push({ payment_id: pid, email: row.customer_email ?? null, reason: 'the organization already has a subscription' });
			continue;
		}
		if (opts.apply) await linkLegacyPayment(row, org._id as Types.ObjectId, { now: () => now });
		report.legacy.linked.push({ payment_id: pid, organization_id: String(org._id) });
	}

	const noTrial = { $or: [{ trial_ends_at: null }, { trial_ends_at: { $exists: false } }] };
	if (opts.apply) {
		const res = await Organization.updateMany(noTrial, { $set: { trial_ends_at: new Date(now.getTime() + plan.trial.days * 86_400_000) } });
		report.trials_started = res.modifiedCount;
	} else report.trials_started = await Organization.countDocuments(noTrial);

	// Legacy coupons have no discount_type (they were per subscription plan).
	const legacyCoupons = { discount_type: { $exists: false } };
	if (opts.apply) {
		const legacy = await Coupon.collection.find(legacyCoupons).toArray();
		for (const c of legacy) {
			await Coupon.collection.updateOne(
				{ _id: c._id },
				{
					$set: {
						discount_type: 'fixed',
						value: Number(c.discount_amount ?? 0) || 0,
						pack_ids: [],
						max_redemptions: 1,
						redemptions: c.is_used ? 1 : 0,
						is_active: false,
						note: 'Legacy subscription coupon (Phase 13a: coupons apply to token packs only)',
						expires_at: c.expires_at ?? null,
					},
				},
			);
		}
		report.coupons_deactivated = legacy.length;
	} else report.coupons_deactivated = await Coupon.collection.countDocuments(legacyCoupons);
	return report;
};
