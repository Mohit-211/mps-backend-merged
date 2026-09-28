import { Types } from 'mongoose';
import { Organization, Subscription } from '../../src/models';
import { standardPlan } from '../../src/services/billing/plans';

// Billing states for tests (Phase 13a).

type Id = Types.ObjectId | string;

/** Moves the organization's trial end (default: far in the future). */
export const setTrial = async (organizationId: Id, until: Date = new Date('2099-01-01T00:00:00Z')): Promise<void> => {
	await Organization.updateOne({ _id: organizationId }, { $set: { trial_ends_at: until } });
};

/** An active subscription with `quantity` paid locations (manual comp by default: no PayPal involved). */
export const activateBilling = async (
	organizationId: Id,
	opts: { quantity?: number; billing_method?: 'paypal' | 'manual'; status?: 'active' | 'past_due' | 'cancelled'; period_start?: Date; period_end?: Date; price?: { first: number; additional: number }; provider_subscription_id?: string | null; past_due_since?: Date | null; comp?: boolean } = {},
) => {
	const plan = await standardPlan();
	const start = opts.period_start ?? new Date(Date.now() - 10 * 86_400_000);
	const end = opts.period_end ?? new Date(start.getTime() + 30 * 86_400_000);
	await Subscription.updateMany({ organization_id: organizationId, open: true }, { $set: { open: false, status: 'cancelled' } });
	return Subscription.create({
		organization_id: organizationId,
		plan_id: plan._id,
		billing_method: opts.billing_method ?? 'manual',
		provider_subscription_id: opts.provider_subscription_id ?? null,
		currency: 'CAD',
		status: opts.status ?? 'active',
		open: opts.status !== 'cancelled',
		started_at: start,
		current_period_start: start,
		current_period_end: end,
		paid_quantity: opts.quantity ?? 5,
		price: opts.price ?? { first: 100, additional: 30 },
		past_due_since: opts.past_due_since ?? null,
		comp_until: opts.comp === false ? null : new Date('2099-01-01T00:00:00Z'),
	});
};
