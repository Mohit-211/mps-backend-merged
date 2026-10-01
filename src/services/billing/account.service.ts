import httpStatus from 'http-status';
import { Types } from 'mongoose';
import { currencyFor, Currency } from '../../billing/constants';
import { monthlyAmount, priceAt } from '../../billing/pricing';
import { IBillingPlan, IInvoice, ITokenLedger, Invoice, Location, Organization, OrganizationBillingDetails, TokenLedger } from '../../models';
import { apiErrorWithData } from '../../utils';
import { loadEntitlement } from './entitlement.service';
import { invoiceView } from './invoices';
import { activePacks, packsFor } from './orders';
import { standardPlan } from './plans';
import { paymentProvider } from './providers';
import { ledgerView } from './tokens';

// The billing page (Phase 13a): one GET with everything the page shows, the public pricing, billing
// details, invoices and the token ledger.

type Id = Types.ObjectId | string;

const priceView = (plan: IBillingPlan, currency: Currency, at: Date) => {
	const now = priceAt(plan.prices, currency, at);
	const upcoming = plan.prices
		.filter((p) => p.currency === currency && new Date(p.effective_from) > at)
		.sort((a, b) => new Date(a.effective_from).getTime() - new Date(b.effective_from).getTime())[0];
	return {
		current: now ? { first_location: now.first, additional_location: now.additional } : null,
		upcoming: upcoming ? { first_location: upcoming.first_location_price, additional_location: upcoming.additional_location_price, effective_from: upcoming.effective_from } : null,
	};
};

export const billingOverview = async (organizationId: Id, at: Date = new Date()) => {
	const { entitlement: e, organization: org, plan, subscription: s } = await loadEntitlement(String(organizationId), at);
	const currency = s?.currency ?? currencyFor(org.country);
	const active = await Location.countDocuments({ organization_id: organizationId, is_active: true });
	let nextRenewal: { date: Date; quantity: number; amount: number | null; fixed: boolean } | null = null;
	if (s && s.current_period_end && (s.status === 'active' || s.status === 'past_due') && !s.cancel_at_period_end && !(s.comp_until && s.comp_until > at)) {
		const nr = s.next_renewal;
		if (nr && nr.period_end.getTime() === s.current_period_end.getTime()) {
			nextRenewal = { date: s.current_period_end, quantity: nr.quantity, amount: nr.amount, fixed: true };
		} else {
			const quantity = Math.max(1, active);
			const p = priceAt(plan.prices, currency, s.current_period_end);
			nextRenewal = { date: s.current_period_end, quantity, amount: p ? monthlyAmount(p, quantity) : null, fixed: false };
		}
	}
	// 2026-10-01: the monthly token grant (custom plans), so the token bar can show "9 of 10 this month".
	// Granted at each paid period start (billing-renewals); the next one is at the current period end.
	const monthlyGrant = plan.monthly_token_grant ?? 0;
	const lastGrant = monthlyGrant > 0
		? await TokenLedger.findOne({ organization_id: organizationId, type: 'monthly_grant' }).sort({ at: -1 }).select({ at: 1, amount: 1 }).lean<Pick<ITokenLedger, 'at' | 'amount'>>()
		: null;
	const grantActive = monthlyGrant > 0 && s && (s.status === 'active' || s.status === 'past_due') && s.current_period_end && !s.cancel_at_period_end;
	return {
		state: e.state,
		read_only: e.read_only,
		trial_ends_at: e.trial_ends_at,
		grace_ends_at: e.grace_ends_at,
		currency,
		plan: { id: String(plan._id), name: plan.name, kind: plan.kind, max_locations: plan.max_locations, users_per_location: plan.users_per_location },
		prices: priceView(plan, currency, at),
		subscription: s
			? {
					id: String(s._id),
					status: s.status,
					billing_method: s.billing_method,
					paid_quantity: s.paid_quantity,
					price: { first_location: s.price.first, additional_location: s.price.additional },
					current_period_start: s.current_period_start,
					current_period_end: s.current_period_end,
					cancel_at_period_end: s.cancel_at_period_end,
					comp_until: s.comp_until,
				}
			: null,
		next_renewal: nextRenewal,
		locations: { active, allowed: e.locations.allowed, max: e.locations.max },
		users: e.users,
		tokens: {
			balance: e.tokens.balance,
			cost_per_refresh: e.tokens.cost_per_refresh,
			monthly_grant: monthlyGrant,
			last_grant_at: lastGrant?.at ?? null,
			next_grant_at: grantActive ? (s?.current_period_end ?? null) : null,
		},
		billing_details: org.billing_details ?? null,
		online_payments: paymentProvider().canSubscribe(currency),
	};
};

/** GET /pricing (public): the standard plan for a country. */
export const publicPricing = async (country: string, at: Date = new Date()) => {
	const currency = currencyFor(country);
	const plan = await standardPlan();
	return {
		currency,
		prices: priceView(plan, currency, at),
		max_locations: plan.max_locations,
		users_per_location: plan.users_per_location,
		trial: { days: plan.trial.days, locations: plan.trial.locations, users: plan.trial.users },
		tokens_per_refresh: plan.tokens_per_refresh,
		token_packs: packsFor(await activePacks(), plan, currency).map(({ id, name, tokens, price, currency: c }) => ({ id, name, tokens, price, currency: c })),
	};
};

export const tokenPacksFor = async (organizationId: Id) => {
	const { organization: org, plan, subscription: s } = await loadEntitlement(String(organizationId));
	const currency = s?.currency ?? currencyFor(org.country);
	return { currency, packs: packsFor(await activePacks(), plan, currency) };
};

const DETAIL_KEYS: (keyof OrganizationBillingDetails)[] = ['name', 'email', 'address_line1', 'address_line2', 'city', 'region', 'postal_code', 'country'];

export const updateBillingDetails = async (organizationId: Id, input: Partial<OrganizationBillingDetails>) => {
	const org = await Organization.findById(organizationId).select({ billing_details: 1 }).lean();
	const current = (org?.billing_details ?? {}) as Partial<OrganizationBillingDetails>;
	const next = Object.fromEntries(DETAIL_KEYS.map((k) => [k, k in input ? (input[k] ?? null) : (current[k] ?? null)])) as unknown as OrganizationBillingDetails;
	await Organization.updateOne({ _id: organizationId }, { $set: { billing_details: next } });
	return next;
};

export const listInvoices = async (organizationId: Id, page: number, limit: number) => {
	const filter = { organization_id: organizationId };
	const [rows, total] = await Promise.all([Invoice.find(filter).sort({ issued_at: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean<IInvoice[]>(), Invoice.countDocuments(filter)]);
	return { invoices: rows.map(invoiceView), page, limit, total };
};

export const findInvoice = async (organizationId: Id, invoiceId: string): Promise<IInvoice> => {
	const inv = Types.ObjectId.isValid(invoiceId) ? await Invoice.findOne({ _id: invoiceId, organization_id: organizationId }).lean<IInvoice>() : null;
	if (!inv) throw apiErrorWithData(httpStatus.NOT_FOUND, 'Invoice not found.', { reason: 'not_found' });
	return inv;
};

export const listLedger = async (organizationId: Id, page: number, limit: number) => {
	const filter = { organization_id: organizationId };
	const [rows, total, org] = await Promise.all([
		TokenLedger.find(filter).sort({ at: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean<ITokenLedger[]>(),
		TokenLedger.countDocuments(filter),
		Organization.findById(organizationId).select({ token_balance: 1 }).lean<{ token_balance?: number }>(),
	]);
	return { balance: org?.token_balance ?? 0, entries: rows.map(ledgerView), page, limit, total };
};
