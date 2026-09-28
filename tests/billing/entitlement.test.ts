import { addLocationDecision, canInvite, entitlementFor, EntitlementInput, hasFeature } from '../../src/billing/entitlement';

const d = (s: string) => new Date(s);
const NOW = d('2026-10-10T12:00:00Z');
const plan = {
	entitlements: {},
	users_per_location: 3,
	max_locations: 20,
	trial: { days: 7, locations: 1, users: 3, tokens: 0 },
	tokens_per_refresh: { rankings: 2, gbp: 1 },
};
const input = (over: Partial<EntitlementInput> = {}): EntitlementInput => ({
	now: NOW,
	grace_days: 7,
	org: { trial_ends_at: null, suspended_at: null, token_balance: 5 },
	plan,
	subscription: null,
	oldest_unpaid_due_at: null,
	usage: { locations: 1, users: 1 },
	...over,
});
const sub = (over: object = {}) => ({ status: 'active' as const, billing_method: 'paypal' as const, current_period_end: d('2026-10-31T00:00:00Z'), past_due_since: null, paid_quantity: 4, comp_until: null, ...over });

describe('entitlementFor', () => {
	it('trial: allowances from the plan; after it, read-only', () => {
		const trial = entitlementFor(input({ org: { trial_ends_at: d('2026-10-15T00:00:00Z'), suspended_at: null, token_balance: 0 } }));
		expect(trial).toMatchObject({ state: 'trialing', read_only: false, subscribed: false, locations: { allowed: 1, max: 20 }, users: { limit: 3 } });
		expect(entitlementFor(input({ org: { trial_ends_at: d('2026-10-09T00:00:00Z'), suspended_at: null, token_balance: 0 } }))).toMatchObject({ state: 'inactive', read_only: true });
	});

	it('active: paid quantity and pooled users; every feature on by default; hasFeature', () => {
		const e = entitlementFor(input({ subscription: sub() }));
		expect(e).toMatchObject({ state: 'active', locations: { allowed: 4 }, users: { limit: 12 }, tokens: { balance: 5, cost_per_refresh: { rankings: 2, gbp: 1 } } });
		expect(hasFeature(e, 'citations')).toBe(true);
		const off = entitlementFor(input({ subscription: sub(), plan: { ...plan, entitlements: { white_label: false } } }));
		expect(hasFeature(off, 'white_label')).toBe(false);
	});

	it('past due: full access within the 7-day grace, then read-only', () => {
		expect(entitlementFor(input({ subscription: sub({ status: 'past_due', past_due_since: d('2026-10-05T00:00:00Z') }) }))).toMatchObject({ state: 'past_due', read_only: false });
		expect(entitlementFor(input({ subscription: sub({ status: 'past_due', past_due_since: d('2026-10-01T00:00:00Z') }) }))).toMatchObject({ state: 'inactive', read_only: true });
	});

	it('cancelled: access until the period end', () => {
		expect(entitlementFor(input({ subscription: sub({ status: 'cancelled' }) })).state).toBe('active');
		expect(entitlementFor(input({ subscription: sub({ status: 'cancelled', current_period_end: d('2026-10-09T00:00:00Z') }) })).state).toBe('inactive');
	});

	it('manual billing: overdue invoices → past_due within grace → inactive; comp until a date', () => {
		const manual = sub({ billing_method: 'manual' });
		expect(entitlementFor(input({ subscription: manual })).state).toBe('active');
		expect(entitlementFor(input({ subscription: manual, oldest_unpaid_due_at: d('2026-10-08T00:00:00Z') })).state).toBe('past_due');
		expect(entitlementFor(input({ subscription: manual, oldest_unpaid_due_at: d('2026-09-30T00:00:00Z') })).state).toBe('inactive');
		expect(entitlementFor(input({ subscription: { ...manual, comp_until: d('2026-12-31T00:00:00Z') }, oldest_unpaid_due_at: d('2026-09-30T00:00:00Z') })).state).toBe('active');
	});

	it('an admin suspension wins over everything', () => {
		expect(entitlementFor(input({ subscription: sub(), org: { trial_ends_at: null, suspended_at: NOW, token_balance: 0 } }))).toMatchObject({ state: 'suspended_by_admin', read_only: true });
	});
});

describe('adding locations and inviting users', () => {
	it('within the paid quantity → ok; beyond → a prorated purchase; beyond the cap → enterprise; trial → subscribe', () => {
		expect(addLocationDecision(entitlementFor(input({ subscription: sub(), usage: { locations: 3, users: 1 } })))).toEqual({ ok: true });
		expect(addLocationDecision(entitlementFor(input({ subscription: sub(), usage: { locations: 4, users: 1 } })))).toEqual({ ok: false, status: 402, reason: 'location_payment_required', slots_needed: 1 });
		expect(addLocationDecision(entitlementFor(input({ subscription: sub({ paid_quantity: 20 }), usage: { locations: 20, users: 1 } })))).toEqual({ ok: false, status: 403, reason: 'enterprise_required', max: 20 });
		expect(addLocationDecision(entitlementFor(input({ subscription: sub({ paid_quantity: 20 }), usage: { locations: 20, users: 1 }, plan: { ...plan, max_locations: null } })))).toMatchObject({ reason: 'location_payment_required' });
		const trial = entitlementFor(input({ org: { trial_ends_at: d('2026-10-15T00:00:00Z'), suspended_at: null, token_balance: 0 } }));
		expect(addLocationDecision(trial)).toEqual({ ok: false, status: 402, reason: 'subscription_required' });
		expect(addLocationDecision(entitlementFor(input()))).toEqual({ ok: false, status: 402, reason: 'subscription_required' });
	});

	it('invites: pooled limit; over the limit existing users stay but no new invites', () => {
		expect(canInvite(entitlementFor(input({ subscription: sub({ paid_quantity: 2 }), usage: { locations: 2, users: 5 } })))).toBe(true);
		expect(canInvite(entitlementFor(input({ subscription: sub({ paid_quantity: 2 }), usage: { locations: 2, users: 6 } })))).toBe(false);
		expect(canInvite(entitlementFor(input({ subscription: sub({ paid_quantity: 1 }), usage: { locations: 1, users: 7 } })))).toBe(false);
	});
});
