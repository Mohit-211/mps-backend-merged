// Billing (Phase 13a): shared enums for plans, subscriptions, invoices, one-time orders and tokens.

export const CURRENCIES = ['USD', 'CAD'] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Organization country → billing currency (US → USD, CA → CAD; unknown → USD). */
export const currencyFor = (country: string | null | undefined): Currency => (String(country ?? '').toUpperCase() === 'CA' ? 'CAD' : 'USD');

/** Every feature a plan can switch on or off. All on for the standard plan (Mohit, 2026-09-28). */
export const FEATURES = ['rank_tracker', 'grid', 'map_ranking', 'gbp_report', 'citations', 'reports', 'white_label', 'competitors', 'team'] as const;
export type Feature = (typeof FEATURES)[number];

export const PLAN_KINDS = ['standard', 'custom'] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

export const BILLING_METHODS = ['paypal', 'manual'] as const;
export type BillingMethod = (typeof BILLING_METHODS)[number];

export const SUBSCRIPTION_STATUSES = ['approval_pending', 'active', 'past_due', 'suspended', 'cancelled', 'expired'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
/** Statuses after which a new subscription can be started. */
export const REFRESH_TOKEN_TYPES = ['rankings', 'gbp'] as const;
export type RefreshTokenType = (typeof REFRESH_TOKEN_TYPES)[number];

export const INVOICE_KINDS = ['subscription', 'location_slots', 'token_pack', 'manual'] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];
export const INVOICE_STATUSES = ['open', 'paid', 'refunded', 'void'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const ORDER_PURPOSES = ['token_pack', 'location_slots'] as const;
export type OrderPurpose = (typeof ORDER_PURPOSES)[number];
export const ORDER_STATUSES = ['created', 'approved', 'captured', 'failed', 'expired'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Phase 18: MyPageSEO tokens per AI action (admin-set per plan; these are the defaults). Reply drafts and
 * analysis are charged per started batch of 10 reviews; cached results cost nothing.
 */
export interface AiTokenCosts {
	reply_drafts_per_10: number;
	analysis_per_10: number;
	appeal: number;
	insights: number;
}
export const AI_TOKEN_COST_DEFAULTS: AiTokenCosts = { reply_drafts_per_10: 1, analysis_per_10: 1, appeal: 1, insights: 2 };

export const LEDGER_TYPES = ['purchase', 'spend', 'refund', 'grant', 'monthly_grant', 'adjustment', 'expiry'] as const;
export type LedgerType = (typeof LEDGER_TYPES)[number];

export const ENTITLEMENT_STATES = ['trialing', 'active', 'past_due', 'inactive', 'suspended_by_admin'] as const;
export type EntitlementState = (typeof ENTITLEMENT_STATES)[number];
