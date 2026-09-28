import { Types } from 'mongoose';
import httpStatus from 'http-status';
import { addLocationDecision, canInvite } from '../../billing/entitlement';
import { Client, IOrganization, Location } from '../../models';
import { apiErrorWithData } from '../../utils';
import { loadEntitlement } from '../billing/entitlement.service';
import { quoteSlots } from '../billing/slots';

// Limits (Phase 8, rebuilt for billing in Phase 13a). Everything comes from the organization's
// entitlement (src/billing/entitlement.ts): trial allowances, the paid location quantity, the plan's
// 20-location cap, and users pooled per paid location. Soft-deleted locations don't count.

type Id = Types.ObjectId | string;
type OrgLike = IOrganization | { _id: Id };

/** Tracked keywords across the organization's active locations. */
export const countKeywords = async (organizationId: Id): Promise<number> => {
	const [row] = await Location.aggregate<{ total: number }>([
		{ $match: { organization_id: new Types.ObjectId(String(organizationId)), is_active: true, deleted_at: null } },
		{ $group: { _id: null, total: { $sum: { $size: { $ifNull: ['$tracking.keywords', []] } } } } },
	]);
	return row?.total ?? 0;
};

const idOf = (org: OrgLike): Id => org._id as Id;

/** GET /organization/usage: the plan, billing state and what is used against the limits. */
export const usageFor = async (org: OrgLike & { type?: string }) => {
	const loaded = await loadEntitlement(idOf(org) as string);
	const e = loaded.entitlement;
	const [keywords, clients] = await Promise.all([
		countKeywords(idOf(org)),
		loaded.organization.type === 'agency' ? Client.countDocuments({ organization_id: idOf(org), is_active: true }) : Promise.resolve(null),
	]);
	return {
		plan: { id: String(loaded.plan._id), name: loaded.plan.name, kind: loaded.plan.kind },
		billing: { state: e.state, read_only: e.read_only, trial_ends_at: e.trial_ends_at, current_period_end: e.current_period_end },
		locations: { used: e.locations.used, limit: e.locations.allowed, max: e.locations.max },
		users: { used: e.users.used, limit: e.users.limit },
		tokens: { balance: e.tokens.balance },
		keywords: { used: keywords, limit: null },
		clients: clients === null ? null : { used: clients },
	};
};

/**
 * Throws when the organization can't add one more location now:
 * 402 subscription_required (trial allowance used / read-only), 402 location_payment_required with a
 * prorated quote (beyond the paid quantity), 403 enterprise_required (beyond the plan's cap).
 */
export const assertCanAddLocation = async (org: OrgLike): Promise<void> => {
	const loaded = await loadEntitlement(idOf(org) as string);
	const decision = addLocationDecision(loaded.entitlement);
	if (!('reason' in decision)) return;
	const e = loaded.entitlement;
	if (decision.reason === 'enterprise_required' && 'max' in decision) {
		throw apiErrorWithData(httpStatus.FORBIDDEN, `The standard plan covers up to ${decision.max} locations. Contact us for an enterprise plan.`, {
			reason: 'enterprise_required',
			used: e.locations.used,
			max: decision.max,
		});
	}
	if (decision.reason === 'location_payment_required' && 'slots_needed' in decision) {
		const quote = quoteSlots(loaded, decision.slots_needed);
		throw apiErrorWithData(httpStatus.PAYMENT_REQUIRED, `Your subscription covers ${e.locations.allowed} location${e.locations.allowed === 1 ? '' : 's'}. Add a location slot to continue.`, {
			reason: 'location_payment_required',
			used: e.locations.used,
			paid: e.locations.allowed,
			quote,
		});
	}
	throw apiErrorWithData(
		httpStatus.PAYMENT_REQUIRED,
		e.state === 'trialing' ? `The trial includes ${e.locations.allowed} location${e.locations.allowed === 1 ? '' : 's'}. Subscribe to add more.` : 'An active subscription is required.',
		{ reason: 'subscription_required', billing: { state: e.state, trial_ends_at: e.trial_ends_at } },
	);
};

/** Throws 403 user_limit_reached when a new invitation would exceed the pooled user limit. */
export const assertCanInvite = async (org: OrgLike): Promise<void> => {
	const loaded = await loadEntitlement(idOf(org) as string);
	const e = loaded.entitlement;
	if (e.read_only) {
		throw apiErrorWithData(httpStatus.PAYMENT_REQUIRED, 'An active subscription is required.', { reason: 'subscription_required', billing: { state: e.state, trial_ends_at: e.trial_ends_at } });
	}
	if (!canInvite(e)) {
		throw apiErrorWithData(httpStatus.FORBIDDEN, `Your plan includes ${e.users.limit} users (${loaded.plan.users_per_location} per location).`, {
			reason: 'user_limit_reached',
			used: e.users.used,
			limit: e.users.limit,
		});
	}
};
