import { BillingMethod, EntitlementState, Feature, FEATURES, SubscriptionStatus } from './constants';
import { userLimit } from './pricing';

// Entitlement (Phase 13a), pure: what an organization may do right now, from its trial, subscription,
// manual invoices, admin suspension and plan. Every feature check goes through hasFeature().

const DAY = 86_400_000;

export interface EntitlementPlan {
	entitlements: Partial<Record<Feature, boolean>>;
	users_per_location: number;
	max_locations: number | null;
	trial: { days: number; locations: number; users: number; tokens: number };
	tokens_per_refresh: { rankings: number; gbp: number };
}

export interface EntitlementSubscription {
	status: SubscriptionStatus;
	billing_method: BillingMethod;
	current_period_end: Date | null;
	past_due_since: Date | null;
	paid_quantity: number;
	comp_until: Date | null;
}

export interface EntitlementInput {
	now: Date;
	grace_days: number;
	org: { trial_ends_at: Date | null; suspended_at: Date | null; token_balance: number; limit_overrides?: { max_locations?: number | null; extra_users?: number } | null };
	plan: EntitlementPlan;
	subscription: EntitlementSubscription | null;
	/** Manual billing: the oldest unpaid invoice's due date. */
	oldest_unpaid_due_at: Date | null;
	usage: { locations: number; users: number };
}

export interface Entitlement {
	state: EntitlementState;
	read_only: boolean;
	subscribed: boolean;
	features: Record<Feature, boolean>;
	locations: { used: number; allowed: number; max: number | null };
	users: { used: number; limit: number };
	tokens: { balance: number; cost_per_refresh: { rankings: number; gbp: number } };
	trial_ends_at: Date | null;
	current_period_end: Date | null;
	grace_ends_at: Date | null;
}

export const hasFeature = (e: Pick<Entitlement, 'features'>, feature: Feature): boolean => e.features[feature] === true;

const plus = (d: Date, days: number) => new Date(d.getTime() + days * DAY);

export const entitlementFor = (i: EntitlementInput): Entitlement => {
	const features = Object.fromEntries(FEATURES.map((f) => [f, i.plan.entitlements[f] !== false])) as Record<Feature, boolean>;
	const base = {
		features,
		tokens: { balance: i.org.token_balance, cost_per_refresh: i.plan.tokens_per_refresh },
		trial_ends_at: i.org.trial_ends_at,
		current_period_end: i.subscription?.current_period_end ?? null,
	};
	// Phase 13b: admin overrides on top of the plan (null max_locations = no cap).
	const o = i.org.limit_overrides ?? null;
	const maxLocations = o && o.max_locations !== undefined ? o.max_locations : i.plan.max_locations;
	const extraUsers = o?.extra_users ?? 0;
	const make = (state: EntitlementState, allowed: number, users: number, subscribed: boolean, graceEnds: Date | null = null): Entitlement => ({
		...base,
		state,
		read_only: state === 'inactive' || state === 'suspended_by_admin',
		subscribed,
		locations: { used: i.usage.locations, allowed, max: maxLocations },
		users: { used: i.usage.users, limit: users + extraUsers },
		grace_ends_at: graceEnds,
	});
	const s = i.subscription;
	const paid = s ? Math.max(1, s.paid_quantity) : 0;
	const paidUsers = userLimit(i.plan.users_per_location, paid);

	if (i.org.suspended_at) return make('suspended_by_admin', paid, paidUsers, Boolean(s));

	if (s && s.billing_method === 'manual' && (s.status === 'active' || s.status === 'past_due')) {
		if (s.comp_until && i.now < s.comp_until) return make('active', paid, paidUsers, true);
		const due = i.oldest_unpaid_due_at;
		if (due && i.now > due) {
			const graceEnds = plus(due, i.grace_days);
			return i.now > graceEnds ? make('inactive', paid, paidUsers, true, graceEnds) : make('past_due', paid, paidUsers, true, graceEnds);
		}
		return make('active', paid, paidUsers, true);
	}
	if (s && s.status === 'active') return make('active', paid, paidUsers, true);
	if (s && s.status === 'past_due') {
		const since = s.past_due_since ?? i.now;
		const graceEnds = plus(since, i.grace_days);
		return i.now > graceEnds ? make('inactive', paid, paidUsers, true, graceEnds) : make('past_due', paid, paidUsers, true, graceEnds);
	}
	// Cancelled (or expired): paid access runs to the end of the period.
	if (s && (s.status === 'cancelled' || s.status === 'expired') && s.current_period_end && i.now < s.current_period_end) {
		return make('active', paid, paidUsers, true);
	}
	if (i.org.trial_ends_at && i.now < i.org.trial_ends_at) return make('trialing', i.plan.trial.locations, i.plan.trial.users, false);
	return make('inactive', 0, Math.max(i.usage.users, 1), false);
};

export type AddLocationDecision =
	| { ok: true }
	| { ok: false; status: 402; reason: 'subscription_required' }
	| { ok: false; status: 402; reason: 'location_payment_required'; slots_needed: number }
	| { ok: false; status: 403; reason: 'enterprise_required'; max: number };

/** May the organization add one more location now? */
export const addLocationDecision = (e: Entitlement): AddLocationDecision => {
	if (e.read_only) return { ok: false, status: 402, reason: 'subscription_required' };
	const next = e.locations.used + 1;
	if (e.locations.max !== null && next > e.locations.max) return { ok: false, status: 403, reason: 'enterprise_required', max: e.locations.max };
	if (next <= e.locations.allowed) return { ok: true };
	if (e.state === 'trialing') return { ok: false, status: 402, reason: 'subscription_required' };
	return { ok: false, status: 402, reason: 'location_payment_required', slots_needed: next - e.locations.allowed };
};

/** May the organization invite one more user? (Existing users over the limit keep access.) */
export const canInvite = (e: Entitlement): boolean => !e.read_only && e.users.used < e.users.limit;
