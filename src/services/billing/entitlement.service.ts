import { Types } from 'mongoose';
import config from '../../configs/config';
import { Entitlement, entitlementFor } from '../../billing/entitlement';
import { IBillingPlan, IOrganization, ISubscription, Invitation, Invoice, Location, Membership, Organization, Subscription } from '../../models';
import { planForOrganization } from './plans';

// Loads what entitlementFor() needs for an organization (Phase 13a): its plan, its latest subscription
// (open, or cancelled with time left), the oldest unpaid manual invoice, and usage (active locations;
// users = active memberships of every role + pending invitations).

type Id = Types.ObjectId | string;

export interface LoadedEntitlement {
	entitlement: Entitlement;
	organization: IOrganization;
	plan: IBillingPlan;
	subscription: ISubscription | null;
}

export const latestSubscription = (organizationId: Id): Promise<ISubscription | null> =>
	Subscription.findOne({ organization_id: organizationId, status: { $ne: 'approval_pending' } })
		.sort({ open: -1, created_at: -1 })
		.lean<ISubscription>();

export const usageOf = async (organizationId: Id): Promise<{ locations: number; users: number }> => {
	const [locations, members, invites] = await Promise.all([
		Location.countDocuments({ organization_id: organizationId, is_active: true }),
		Membership.countDocuments({ organization_id: organizationId, status: 'active' }),
		Invitation.countDocuments({ organization_id: organizationId, status: 'pending', expires_at: { $gt: new Date() } }),
	]);
	return { locations, users: members + invites };
};

export const loadEntitlement = async (org: Id | IOrganization, now: Date = new Date()): Promise<LoadedEntitlement> => {
	const organization = (typeof org === 'string' || org instanceof Types.ObjectId ? await Organization.findById(org).lean<IOrganization>() : org) as IOrganization;
	if (!organization) throw new Error('organization not found');
	const [plan, subscription, usage, unpaid] = await Promise.all([
		planForOrganization(organization),
		latestSubscription(organization._id as Types.ObjectId),
		usageOf(organization._id as Types.ObjectId),
		Invoice.findOne({ organization_id: organization._id, status: 'open', due_at: { $ne: null } }).sort({ due_at: 1 }).select({ due_at: 1 }).lean<{ due_at: Date }>(),
	]);
	const entitlement = entitlementFor({
		now,
		grace_days: config.billing.graceDays,
		org: { trial_ends_at: organization.trial_ends_at ?? null, suspended_at: organization.suspended_at ?? null, token_balance: organization.token_balance ?? 0, limit_overrides: organization.limit_overrides ?? null },
		plan,
		subscription: subscription
			? {
					status: subscription.status,
					billing_method: subscription.billing_method,
					current_period_end: subscription.current_period_end,
					past_due_since: subscription.past_due_since,
					paid_quantity: subscription.paid_quantity,
					comp_until: subscription.comp_until,
				}
			: null,
		oldest_unpaid_due_at: unpaid?.due_at ?? null,
		usage,
	});
	return { entitlement, organization, plan, subscription };
};
