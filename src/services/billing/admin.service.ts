import httpStatus from 'http-status';
import { Types } from 'mongoose';
import { paypalClient } from '../../clients/paypalClient';
import config from '../../configs/config';
import { BillingMethod, currencyFor, Currency } from '../../billing/constants';
import { monthlyLines, priceAt } from '../../billing/pricing';
import {
	AuditLog,
	BillingPlan,
	Coupon,
	IAuditLog,
	IBillingPlan,
	ICoupon,
	IInvoice,
	IOrganization,
	ISubscription,
	ITokenPack,
	Invoice,
	Organization,
	Subscription,
	TokenPack,
} from '../../models';
import { apiErrorWithData } from '../../utils';
import { billingOverview, listLedger } from './account.service';
import { audit, AuditActor } from './audit';
import { couponView } from './coupons';
import { invoiceService, invoiceView } from './invoices';
import { planForOrganization, standardPlan } from './plans';
import { createSubscriptionService } from './subscriptions';
import { credit } from './tokens';

// Billing admin (Phase 13a), behind billing.read / billing.manage. Every change is written to the
// audit log (who, when, before → after).

const notFound = (what: string) => apiErrorWithData(httpStatus.NOT_FOUND, `${what} not found.`, { reason: 'not_found' });
const conflict = (reason: string, message: string, data: Record<string, unknown> = {}) => apiErrorWithData(httpStatus.CONFLICT, message, { reason, ...data });
const oid = (id: string) => (Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null);
const DAY = 86_400_000;

// ---- plans ----

export const planView = (p: IBillingPlan) => ({
	id: String(p._id),
	name: p.name,
	kind: p.kind,
	organization_id: p.organization_id ? String(p.organization_id) : null,
	entitlements: p.entitlements,
	users_per_location: p.users_per_location,
	max_locations: p.max_locations,
	trial: p.trial,
	tokens_per_refresh: p.tokens_per_refresh,
	monthly_token_grant: p.monthly_token_grant,
	token_pack_discount_percent: p.token_pack_discount_percent,
	token_pack_prices: (p.token_pack_prices ?? []).map((x) => ({ pack_id: String(x.pack_id), currency: x.currency, price: x.price })),
	prices: [...(p.prices ?? [])]
		.sort((a, b) => new Date(a.effective_from).getTime() - new Date(b.effective_from).getTime())
		.map((x) => ({ currency: x.currency, first_location_price: x.first_location_price, additional_location_price: x.additional_location_price, effective_from: x.effective_from, set_by: x.set_by ? String(x.set_by) : null, set_at: x.set_at })),
	is_active: p.is_active,
	created_at: p.created_at,
	updated_at: p.updated_at,
});

export const listPlans = async (filter: { kind?: string; organization_id?: string }) => {
	await standardPlan();
	const q: Record<string, unknown> = {};
	if (filter.kind) q.kind = filter.kind;
	if (filter.organization_id) q.organization_id = oid(filter.organization_id);
	const plans = await BillingPlan.find(q).sort({ kind: -1, created_at: 1 }).lean<IBillingPlan[]>();
	return plans.map(planView);
};

const loadPlan = async (planId: string) => {
	const plan = oid(planId) ? await BillingPlan.findById(planId).lean<IBillingPlan>() : null;
	if (!plan) throw notFound('Plan');
	return plan;
};

export const getPlan = async (planId: string) => planView(await loadPlan(planId));

export type PlanSettings = Partial<Pick<IBillingPlan, 'name' | 'entitlements' | 'users_per_location' | 'max_locations' | 'trial' | 'tokens_per_refresh' | 'monthly_token_grant' | 'token_pack_discount_percent' | 'is_active'>> & {
	token_pack_prices?: { pack_id: string; currency: Currency; price: number }[];
};

export const updatePlan = async (actor: AuditActor, planId: string, input: PlanSettings) => {
	const plan = await loadPlan(planId);
	if (plan.kind === 'standard' && input.max_locations === null) throw apiErrorWithData(httpStatus.BAD_REQUEST, 'The standard plan needs a location cap.', { reason: 'invalid_plan' });
	if (plan.kind === 'standard' && input.is_active === false) throw apiErrorWithData(httpStatus.BAD_REQUEST, 'The standard plan cannot be deactivated.', { reason: 'invalid_plan' });
	const set: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(input)) {
		if (v === undefined) continue;
		if (k === 'entitlements' || k === 'trial' || k === 'tokens_per_refresh') {
			for (const [sub, val] of Object.entries(v as Record<string, unknown>)) set[`${k}.${sub}`] = val;
		} else if (k === 'token_pack_prices') {
			set[k] = (v as PlanSettings['token_pack_prices'])?.map((x) => ({ pack_id: new Types.ObjectId(x.pack_id), currency: x.currency, price: x.price }));
		} else set[k] = v;
	}
	const updated = (await BillingPlan.findByIdAndUpdate(plan._id, { $set: set }, { new: true }).lean<IBillingPlan>()) as IBillingPlan;
	await audit(actor, { action: 'billing.plan.update', organization_id: plan.organization_id, target: `plan:${String(plan._id)}`, before: planView(plan), after: planView(updated) });
	return planView(updated);
};

/** A dated price. The same currency and date replaces it; a date in the past is refused (it would rewrite history). */
export const addPlanPrice = async (actor: AuditActor, planId: string, input: { currency: Currency; first_location_price: number; additional_location_price: number; effective_from: Date }, now: Date = new Date()) => {
	const plan = await loadPlan(planId);
	const from = new Date(input.effective_from);
	if (from.getTime() < now.getTime() - DAY) throw apiErrorWithData(httpStatus.BAD_REQUEST, 'A price must start today or later.', { reason: 'effective_from_in_past' });
	const prices = (plan.prices ?? []).filter((p) => !(p.currency === input.currency && new Date(p.effective_from).getTime() === from.getTime()));
	prices.push({ currency: input.currency, first_location_price: input.first_location_price, additional_location_price: input.additional_location_price, effective_from: from, set_by: new Types.ObjectId(actor.id), set_at: now });
	const updated = (await BillingPlan.findByIdAndUpdate(plan._id, { $set: { prices } }, { new: true }).lean<IBillingPlan>()) as IBillingPlan;
	await audit(actor, { action: 'billing.plan.price', organization_id: plan.organization_id, target: `plan:${String(plan._id)}`, before: planView(plan).prices, after: planView(updated).prices }, now);
	return planView(updated);
};

// ---- organizations ----

const loadOrg = async (organizationId: string) => {
	const org = oid(organizationId) ? await Organization.findById(organizationId).lean<IOrganization>() : null;
	if (!org) throw notFound('Organization');
	return org;
};

export const organizationBilling = async (organizationId: string) => {
	const org = await loadOrg(organizationId);
	const [overview, subscriptions, invoices, auditRows] = await Promise.all([
		billingOverview(org._id as Types.ObjectId),
		Subscription.find({ organization_id: org._id }).sort({ created_at: -1 }).limit(10).lean<ISubscription[]>(),
		Invoice.find({ organization_id: org._id }).sort({ issued_at: -1 }).limit(20).lean<IInvoice[]>(),
		AuditLog.find({ organization_id: org._id }).sort({ at: -1 }).limit(20).lean<IAuditLog[]>(),
	]);
	return {
		organization: { id: String(org._id), name: org.name, type: org.type, country: org.country, plan_id: org.plan_id ? String(org.plan_id) : null, billing_method: org.billing_method ?? 'paypal', trial_ends_at: org.trial_ends_at ?? null, suspended_at: org.suspended_at ?? null },
		billing: overview,
		subscriptions: subscriptions.map(subscriptionView),
		invoices: invoices.map(invoiceView),
		audit: auditRows.map(auditView),
	};
};

/** A custom (enterprise) plan for one organization, starting from the standard plan's settings. */
export const createCustomPlan = async (actor: AuditActor, organizationId: string, input: PlanSettings & { billing_method?: BillingMethod }) => {
	const org = await loadOrg(organizationId);
	const current = org.plan_id ? await BillingPlan.findOne({ _id: org.plan_id, kind: 'custom', is_active: true }).lean() : null;
	if (current) throw conflict('custom_plan_exists', 'This organization already has a custom plan; edit it instead.', { plan_id: String(current._id) });
	const base = await standardPlan();
	const { billing_method: method, token_pack_prices: packPrices, ...settings } = input;
	const plan = (
		await BillingPlan.create({
			name: settings.name ?? `${org.name} (custom)`,
			kind: 'custom',
			organization_id: org._id,
			entitlements: { ...base.entitlements, ...(settings.entitlements ?? {}) },
			users_per_location: settings.users_per_location ?? base.users_per_location,
			max_locations: settings.max_locations === undefined ? base.max_locations : settings.max_locations,
			trial: { ...base.trial, ...(settings.trial ?? {}) },
			tokens_per_refresh: { ...base.tokens_per_refresh, ...(settings.tokens_per_refresh ?? {}) },
			monthly_token_grant: settings.monthly_token_grant ?? 0,
			token_pack_discount_percent: settings.token_pack_discount_percent ?? 0,
			token_pack_prices: (packPrices ?? []).map((x) => ({ pack_id: new Types.ObjectId(x.pack_id), currency: x.currency, price: x.price })),
			prices: [],
		})
	).toObject() as IBillingPlan;
	const set: Record<string, unknown> = { plan_id: plan._id };
	if (method) set.billing_method = method;
	await Organization.updateOne({ _id: org._id }, { $set: set });
	await audit(actor, { action: 'billing.custom_plan.create', organization_id: org._id, target: `plan:${String(plan._id)}`, before: { plan_id: org.plan_id ?? null, billing_method: org.billing_method ?? 'paypal' }, after: { ...planView(plan), billing_method: method ?? org.billing_method ?? 'paypal' } });
	return planView(plan);
};

/** Back to the standard plan (the next renewal uses its prices). */
export const removeCustomPlan = async (actor: AuditActor, organizationId: string) => {
	const org = await loadOrg(organizationId);
	if (!org.plan_id) throw conflict('no_custom_plan', 'This organization is on the standard plan.');
	await BillingPlan.updateOne({ _id: org.plan_id, kind: 'custom' }, { $set: { is_active: false } });
	await Organization.updateOne({ _id: org._id }, { $set: { plan_id: null } });
	await audit(actor, { action: 'billing.custom_plan.remove', organization_id: org._id, target: `plan:${String(org.plan_id)}`, before: { plan_id: String(org.plan_id) }, after: { plan_id: null } });
	return { plan_id: null };
};

export const setBillingMethod = async (actor: AuditActor, organizationId: string, method: BillingMethod) => {
	const org = await loadOrg(organizationId);
	const open = await Subscription.findOne({ organization_id: org._id, open: true }).lean<ISubscription>();
	if (open && open.billing_method !== method) throw conflict('subscription_open', 'Cancel the open subscription before changing the billing method.', { subscription_id: String(open._id) });
	await Organization.updateOne({ _id: org._id }, { $set: { billing_method: method } });
	await audit(actor, { action: 'billing.method', organization_id: org._id, before: org.billing_method ?? 'paypal', after: method });
	return { billing_method: method };
};

/** A manual-billing subscription (invoices), optionally comped (free) until a date. */
export const startManualSubscription = async (actor: AuditActor, organizationId: string, input: { quantity: number; starts_at?: Date; comp_until?: Date | null; currency?: Currency; note?: string | null }, now: Date = new Date()) => {
	const org = await loadOrg(organizationId);
	if (await Subscription.exists({ organization_id: org._id, open: true })) throw conflict('already_subscribed', 'This organization already has an open subscription.');
	const plan = await planForOrganization(org);
	if (plan.max_locations !== null && input.quantity > plan.max_locations) throw apiErrorWithData(httpStatus.FORBIDDEN, 'More locations need a custom plan.', { reason: 'enterprise_required', max: plan.max_locations });
	const start = input.starts_at ? new Date(input.starts_at) : now;
	const end = new Date(start);
	end.setUTCMonth(end.getUTCMonth() + 1);
	const currency = input.currency ?? currencyFor(org.country);
	const price = priceAt(plan.prices ?? [], currency, start) ?? { first: 0, additional: 0 };
	const sub = (
		await Subscription.create({
			organization_id: org._id,
			plan_id: plan._id,
			billing_method: 'manual',
			currency,
			status: 'active',
			open: true,
			started_at: start,
			current_period_start: start,
			current_period_end: end,
			paid_quantity: input.quantity,
			price,
			comp_until: input.comp_until ?? null,
			note: input.note ?? null,
			created_by: new Types.ObjectId(actor.id),
			events: [{ at: now, type: 'manual_started', detail: input.comp_until ? `comped until ${new Date(input.comp_until).toISOString().slice(0, 10)}` : null }],
		})
	).toObject() as ISubscription;
	await Organization.updateOne({ _id: org._id }, { $set: { billing_method: 'manual' } });
	// The first period is invoiced at once unless comped (later periods: billing-renewals).
	if (!(input.comp_until && new Date(input.comp_until) > start)) {
		await invoiceService.issue({
			organization_id: org._id,
			subscription_id: sub._id,
			kind: 'manual',
			status: 'open',
			currency,
			lines: monthlyLines(price, input.quantity),
			provider_ref: `manual:${String(sub._id)}:${start.toISOString()}`,
			period_start: start,
			period_end: end,
			due_at: new Date(start.getTime() + config.billing.manualInvoiceDueDays * DAY),
		});
	}
	await audit(actor, { action: 'billing.subscription.manual_start', organization_id: org._id, target: `subscription:${String(sub._id)}`, after: subscriptionView(sub) }, now);
	return subscriptionView(sub);
};

export const extendTrial = async (actor: AuditActor, organizationId: string, until: Date) => {
	const org = await loadOrg(organizationId);
	await Organization.updateOne({ _id: org._id }, { $set: { trial_ends_at: until, billing_reminders: null } });
	await audit(actor, { action: 'billing.trial', organization_id: org._id, before: org.trial_ends_at ?? null, after: until });
	return { trial_ends_at: until };
};

export const adjustTokens = async (actor: AuditActor, organizationId: string, input: { amount: number; type: 'grant' | 'adjustment'; note: string }) => {
	const org = await loadOrg(organizationId);
	if (input.type === 'grant' && input.amount <= 0) throw apiErrorWithData(httpStatus.BAD_REQUEST, 'A grant must be positive.', { reason: 'invalid_amount' });
	const balance = await credit(org._id as Types.ObjectId, input.type, input.amount, { actor: { kind: 'admin', id: new Types.ObjectId(actor.id), name: actor.name }, note: input.note });
	await audit(actor, { action: `billing.tokens.${input.type}`, organization_id: org._id, before: org.token_balance ?? 0, after: balance, note: input.note });
	return { balance };
};

export const organizationLedger = async (organizationId: string, page: number, limit: number) => listLedger((await loadOrg(organizationId))._id as Types.ObjectId, page, limit);

// ---- subscriptions ----

export const subscriptionView = (s: ISubscription) => ({
	id: String(s._id),
	organization_id: String(s.organization_id),
	plan_id: String(s.plan_id),
	billing_method: s.billing_method,
	provider_subscription_id: s.provider_subscription_id,
	currency: s.currency,
	status: s.status,
	open: s.open,
	paid_quantity: s.paid_quantity,
	price: s.price,
	current_period_start: s.current_period_start,
	current_period_end: s.current_period_end,
	next_renewal: s.next_renewal,
	pending_lines: s.pending_lines ?? [],
	cancel_at_period_end: s.cancel_at_period_end,
	cancelled_at: s.cancelled_at,
	past_due_since: s.past_due_since,
	failed_payments: s.failed_payments,
	last_payment_at: s.last_payment_at,
	comp_until: s.comp_until,
	note: s.note,
	created_at: s.created_at,
});

export const listSubscriptions = async (f: { status?: string; billing_method?: string; organization_id?: string; page: number; limit: number }) => {
	const q: Record<string, unknown> = {};
	if (f.status) q.status = f.status;
	if (f.billing_method) q.billing_method = f.billing_method;
	if (f.organization_id) q.organization_id = oid(f.organization_id);
	const [rows, total] = await Promise.all([Subscription.find(q).sort({ created_at: -1 }).skip((f.page - 1) * f.limit).limit(f.limit).lean<ISubscription[]>(), Subscription.countDocuments(q)]);
	const orgs = await Organization.find({ _id: { $in: rows.map((r) => r.organization_id) } }).select({ name: 1 }).lean<{ _id: Types.ObjectId; name: string }[]>();
	const names = new Map(orgs.map((o) => [String(o._id), o.name]));
	return { subscriptions: rows.map((r) => ({ ...subscriptionView(r), organization_name: names.get(String(r.organization_id)) ?? null })), page: f.page, limit: f.limit, total };
};

const loadSubscription = async (id: string) => {
	const sub = oid(id) ? await Subscription.findById(id).lean<ISubscription>() : null;
	if (!sub) throw notFound('Subscription');
	return sub;
};

export const getSubscription = async (id: string) => {
	const sub = await loadSubscription(id);
	const invoices = await Invoice.find({ subscription_id: sub._id }).sort({ issued_at: -1 }).limit(50).lean<IInvoice[]>();
	return { ...subscriptionView(sub), events: sub.events ?? [], invoices: invoices.map(invoiceView) };
};

export const syncSubscription = async (actor: AuditActor, id: string) => {
	const sub = await loadSubscription(id);
	if (!sub.provider_subscription_id) throw conflict('not_paypal', 'This subscription is not billed through PayPal.');
	const client = paypalClient();
	if (!client.configured()) throw apiErrorWithData(httpStatus.SERVICE_UNAVAILABLE, 'PayPal is not configured.', { reason: 'billing_not_configured' });
	const updated = await createSubscriptionService().applyPaypal(sub, await client.getSubscription(sub.provider_subscription_id));
	await audit(actor, { action: 'billing.subscription.sync', organization_id: sub.organization_id, target: `subscription:${id}`, before: sub.status, after: updated.status });
	return subscriptionView(updated);
};

export const cancelSubscription = async (actor: AuditActor, id: string, reason: string) => {
	const sub = await loadSubscription(id);
	if (!sub.open) throw conflict('not_open', 'This subscription is not open.');
	if (sub.billing_method === 'paypal' && sub.provider_subscription_id && sub.status !== 'approval_pending') {
		const client = paypalClient();
		if (!client.configured()) throw apiErrorWithData(httpStatus.SERVICE_UNAVAILABLE, 'PayPal is not configured.', { reason: 'billing_not_configured' });
		await client.cancelSubscription(sub.provider_subscription_id, reason || 'Cancelled by MyPageSEO');
	}
	const now = new Date();
	const updated = (await Subscription.findByIdAndUpdate(
		sub._id,
		{ $set: { status: 'cancelled', open: false, cancel_at_period_end: true, cancelled_at: now }, $push: { events: { $each: [{ at: now, type: 'cancelled', detail: `admin:${actor.id}` }], $slice: -50 } } },
		{ new: true },
	).lean<ISubscription>()) as ISubscription;
	await audit(actor, { action: 'billing.subscription.cancel', organization_id: sub.organization_id, target: `subscription:${id}`, before: sub.status, after: 'cancelled', note: reason || null }, now);
	return subscriptionView(updated);
};

/** Admin edits: comp_until, note, and (manual billing only) the paid quantity. */
export const updateSubscription = async (actor: AuditActor, id: string, input: { comp_until?: Date | null; paid_quantity?: number; note?: string | null }) => {
	const sub = await loadSubscription(id);
	if (input.paid_quantity !== undefined && sub.billing_method !== 'manual') throw conflict('not_manual', 'The paid quantity of a PayPal subscription changes through payments.');
	const set: Record<string, unknown> = {};
	if (input.comp_until !== undefined) set.comp_until = input.comp_until;
	if (input.paid_quantity !== undefined) set.paid_quantity = input.paid_quantity;
	if (input.note !== undefined) set.note = input.note;
	const updated = (await Subscription.findByIdAndUpdate(sub._id, { $set: set }, { new: true }).lean<ISubscription>()) as ISubscription;
	await audit(actor, { action: 'billing.subscription.update', organization_id: sub.organization_id, target: `subscription:${id}`, before: { comp_until: sub.comp_until, paid_quantity: sub.paid_quantity, note: sub.note }, after: set });
	return subscriptionView(updated);
};

// ---- invoices ----

export const listInvoicesAdmin = async (f: { status?: string; kind?: string; organization_id?: string; q?: string; page: number; limit: number }) => {
	const q: Record<string, unknown> = {};
	if (f.status) q.status = f.status;
	if (f.kind) q.kind = f.kind;
	if (f.organization_id) q.organization_id = oid(f.organization_id);
	if (f.q) q.number = { $regex: `^${f.q.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '')}` };
	const [rows, total] = await Promise.all([Invoice.find(q).sort({ issued_at: -1, _id: -1 }).skip((f.page - 1) * f.limit).limit(f.limit).lean<IInvoice[]>(), Invoice.countDocuments(q)]);
	return { invoices: rows.map((r) => ({ ...invoiceView(r), organization_id: String(r.organization_id), customer: r.customer, mismatch: r.mismatch, payment_note: r.payment_note })), page: f.page, limit: f.limit, total };
};

export const loadInvoice = async (id: string) => {
	const inv = oid(id) ? await Invoice.findById(id).lean<IInvoice>() : null;
	if (!inv) throw notFound('Invoice');
	return inv;
};

export const recordInvoicePayment = async (actor: AuditActor, id: string, note: string) => {
	const inv = await loadInvoice(id);
	if (inv.status !== 'open') throw conflict('invoice_not_open', 'Only an open invoice can be marked paid.', { status: inv.status });
	const paid = await invoiceService.markPaid(inv._id, note);
	if (!paid) throw conflict('invoice_not_open', 'Only an open invoice can be marked paid.');
	await audit(actor, { action: 'billing.invoice.paid', organization_id: inv.organization_id, target: `invoice:${inv.number}`, before: 'open', after: 'paid', note });
	return invoiceView(paid);
};

export const voidInvoice = async (actor: AuditActor, id: string, note: string) => {
	const inv = await loadInvoice(id);
	if (inv.status !== 'open') throw conflict('invoice_not_open', 'Only an open invoice can be voided.', { status: inv.status });
	const updated = await invoiceService.setStatus({ _id: inv._id, status: 'open' }, 'void', note);
	if (!updated) throw conflict('invoice_not_open', 'Only an open invoice can be voided.');
	await audit(actor, { action: 'billing.invoice.void', organization_id: inv.organization_id, target: `invoice:${inv.number}`, before: 'open', after: 'void', note });
	return invoiceView(updated);
};

// ---- token packs and coupons ----

export const packView = (p: ITokenPack) => ({ id: String(p._id), name: p.name, tokens: p.tokens, prices: p.prices, expires_after_days: p.expires_after_days, is_active: p.is_active, sort_order: p.sort_order });

export const listPacks = async () => (await TokenPack.find({}).sort({ sort_order: 1, tokens: 1 }).lean<ITokenPack[]>()).map(packView);

export const createPack = async (actor: AuditActor, input: Partial<ITokenPack>) => {
	const pack = (await TokenPack.create(input)).toObject() as ITokenPack;
	await audit(actor, { action: 'billing.pack.create', target: `pack:${String(pack._id)}`, after: packView(pack) });
	return packView(pack);
};

export const updatePack = async (actor: AuditActor, id: string, input: Partial<ITokenPack>) => {
	const before = oid(id) ? await TokenPack.findById(id).lean<ITokenPack>() : null;
	if (!before) throw notFound('Token pack');
	const after = (await TokenPack.findByIdAndUpdate(before._id, { $set: input }, { new: true }).lean<ITokenPack>()) as ITokenPack;
	await audit(actor, { action: 'billing.pack.update', target: `pack:${id}`, before: packView(before), after: packView(after) });
	return packView(after);
};

export const listCoupons = async () => (await Coupon.find({}).sort({ created_at: -1 }).lean<ICoupon[]>()).map(couponView);

export const createCoupon = async (actor: AuditActor, input: Partial<ICoupon>) => {
	if (await Coupon.exists({ code: String(input.code).trim().toUpperCase() })) throw conflict('code_taken', 'A coupon with this code exists.');
	const coupon = (await Coupon.create(input)).toObject() as ICoupon;
	await audit(actor, { action: 'billing.coupon.create', target: `coupon:${coupon.code}`, after: couponView(coupon) });
	return couponView(coupon);
};

export const updateCoupon = async (actor: AuditActor, id: string, input: Partial<ICoupon>) => {
	const before = oid(id) ? await Coupon.findById(id).lean<ICoupon>() : null;
	if (!before) throw notFound('Coupon');
	const after = (await Coupon.findByIdAndUpdate(before._id, { $set: input }, { new: true }).lean<ICoupon>()) as ICoupon;
	await audit(actor, { action: 'billing.coupon.update', target: `coupon:${before.code}`, before: couponView(before), after: couponView(after) });
	return couponView(after);
};

export const auditView = (a: IAuditLog) => ({
	id: String(a._id),
	action: a.action,
	organization_id: a.organization_id ? String(a.organization_id) : null,
	target: a.target,
	before: a.before,
	after: a.after,
	note: a.note,
	by: { admin_id: a.actor?.admin_id ? String(a.actor.admin_id) : null, name: a.actor?.name ?? null },
	at: a.at,
});

export const listAudit = async (f: { organization_id?: string; action?: string; page: number; limit: number }) => {
	const q: Record<string, unknown> = { action: { $regex: '^billing\\.' } };
	if (f.organization_id) q.organization_id = oid(f.organization_id);
	if (f.action) q.action = f.action;
	const [rows, total] = await Promise.all([AuditLog.find(q).sort({ at: -1 }).skip((f.page - 1) * f.limit).limit(f.limit).lean<IAuditLog[]>(), AuditLog.countDocuments(q)]);
	return { entries: rows.map(auditView), page: f.page, limit: f.limit, total };
};
