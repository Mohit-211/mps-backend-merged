import httpStatus from 'http-status';
import { Types } from 'mongoose';
import { PaypalClient, PaypalSubscription, paypalClient } from '../../clients/paypalClient';
import config from '../../configs/config';
import logger from '../../configs/logger';
import { currencyFor, SubscriptionStatus } from '../../billing/constants';
import { monthlyLines, priceAt } from '../../billing/pricing';
import { Invoice, ISubscription, Location, Organization, Subscription } from '../../models';
import { apiErrorWithData } from '../../utils';
import { loadEntitlement } from './entitlement.service';
import { invoiceService } from './invoices';
import { notify } from './notify';
import { planForOrganization } from './plans';
import { creditOnce } from './tokens';

// Subscriptions (Phase 13a): checkout, the PayPal status mapping, payments (first and renewals) and
// cancellation. The webhooks are authoritative; /billing/sync re-reads PayPal after the return page.

type Id = Types.ObjectId | string;
const DAY = 86_400_000;
const OPEN_STATUSES: SubscriptionStatus[] = ['approval_pending', 'active', 'past_due'];

export interface BillingDeps {
	paypal?: () => PaypalClient;
	now?: () => Date;
}

const brand = () => 'MyPageSEO';
const returnUrl = (query: string) => `${(config.auth.frontendUrl || '').replace(/\/$/, '')}/settings/billing?${query}`;

const pushEvent = (type: string, detail: string | null, at: Date) => ({ $push: { events: { $each: [{ at, type, detail }], $slice: -50 } } });

export const notConfigured = () => apiErrorWithData(httpStatus.SERVICE_UNAVAILABLE, 'Online payments are not configured yet.', { reason: 'billing_not_configured' });

export const createSubscriptionService = (deps: BillingDeps = {}) => {
	const pp = deps.paypal ?? paypalClient;
	const now = deps.now ?? (() => new Date());

	/** Starts a PayPal subscription for the organization's active locations → approve_url. */
	const checkout = async (organizationId: Id, userId: Id) => {
		const at = now();
		const loaded = await loadEntitlement(String(organizationId), at);
		const { organization: org, plan } = loaded;
		if (org.billing_method === 'manual') throw apiErrorWithData(httpStatus.CONFLICT, 'This organization is billed by invoice. Contact us to change it.', { reason: 'manual_billing' });
		const open = await Subscription.findOne({ organization_id: organizationId, open: true }).lean<ISubscription>();
		if (open && open.status !== 'approval_pending') throw apiErrorWithData(httpStatus.CONFLICT, 'This organization already has a subscription.', { reason: 'already_subscribed' });
		const currency = currencyFor(org.country);
		const price = priceAt(plan.prices, currency, at);
		if (!price) throw apiErrorWithData(httpStatus.CONFLICT, 'Prices are not set yet.', { reason: 'price_not_set' });
		const client = pp();
		const planId = config.paypal.planIds[currency];
		if (!client.configured() || !planId) throw notConfigured();

		const active = await Location.countDocuments({ organization_id: organizationId, is_active: true });
		if (plan.max_locations !== null && active > plan.max_locations) {
			throw apiErrorWithData(httpStatus.FORBIDDEN, 'This number of locations needs an enterprise plan.', { reason: 'enterprise_required', max: plan.max_locations });
		}
		const quantity = Math.max(1, active);
		// A cancelled subscription still paid until its period end: the new one starts then.
		const prev = loaded.subscription;
		const startAt = prev && prev.current_period_end && prev.current_period_end > at && ['cancelled', 'expired'].includes(prev.status) ? prev.current_period_end : null;

		if (open) await Subscription.updateOne({ _id: open._id, status: 'approval_pending' }, { $set: { open: false, status: 'expired' }, ...pushEvent('replaced', 'a new checkout was started', at) });
		const lines = monthlyLines(price, quantity);
		const monthly = lines.reduce((s, l) => s + l.amount, 0);
		const sub = await Subscription.create({
			organization_id: organizationId,
			plan_id: plan._id,
			billing_method: 'paypal',
			currency,
			status: 'approval_pending',
			open: true,
			paid_quantity: quantity,
			price,
			created_by: userId,
			events: [{ at, type: 'checkout', detail: `${quantity} location(s), ${currency} ${monthly.toFixed(2)}/month` }],
		});
		try {
			const r = await client.createSubscription({
				plan_id: planId,
				custom_id: String(sub._id),
				monthly,
				currency,
				return_url: returnUrl('checkout=success'),
				cancel_url: returnUrl('checkout=cancelled'),
				brand_name: brand(),
				request_id: `sub-${String(sub._id)}`,
				start_time: startAt,
			});
			await Subscription.updateOne({ _id: sub._id }, { $set: { provider_subscription_id: r.id } });
			return { subscription_id: String(sub._id), approve_url: r.approve_url, quantity, currency, monthly_amount: monthly, starts_at: startAt };
		} catch (err) {
			await Subscription.updateOne({ _id: sub._id }, { $set: { open: false, status: 'expired' }, ...pushEvent('checkout_failed', (err as Error).message.slice(0, 200), at) });
			throw err;
		}
	};

	/** Maps PayPal's view onto ours (status, first period). Periods advance only on payments. */
	const applyPaypal = async (sub: ISubscription, ps: PaypalSubscription): Promise<ISubscription> => {
		const at = now();
		const raw = ps.status.toUpperCase();
		let status: SubscriptionStatus = sub.status;
		if (raw === 'APPROVAL_PENDING' || raw === 'APPROVED') status = 'approval_pending';
		else if (raw === 'ACTIVE') status = sub.status === 'past_due' && ps.failed_payments_count > 0 ? 'past_due' : 'active';
		else if (raw === 'SUSPENDED') status = 'suspended';
		else if (raw === 'CANCELLED') status = 'cancelled';
		else if (raw === 'EXPIRED') status = 'expired';
		const set: Record<string, unknown> = { status, open: OPEN_STATUSES.includes(status) };
		if (status === 'active' || status === 'past_due') {
			if (!sub.started_at) set.started_at = ps.start_time ? new Date(ps.start_time) : at;
			if (!sub.current_period_start) set.current_period_start = ps.start_time ? new Date(ps.start_time) : at;
			if (!sub.current_period_end && ps.next_billing_time) set.current_period_end = new Date(ps.next_billing_time);
		}
		if (status === 'active') set.past_due_since = null;
		if ((status === 'cancelled' || status === 'expired' || status === 'suspended') && !sub.cancelled_at) {
			set.cancelled_at = at;
			set.cancel_at_period_end = true;
		}
		if (status === sub.status && set.open === sub.open && Object.keys(set).length === 2) return sub;
		const updated = (await Subscription.findByIdAndUpdate(sub._id, { $set: set, ...pushEvent(`paypal_${raw.toLowerCase()}`, null, at) }, { new: true }).lean<ISubscription>()) as ISubscription;
		const org = String(sub.organization_id);
		if (status !== sub.status) {
			logger.info(`billing: subscription ${String(sub._id)} ${sub.status} → ${status}`);
			if (status === 'active' && sub.status === 'approval_pending') await notify({ kind: 'subscription_activated', organization_id: org });
			if (status === 'cancelled' || status === 'expired' || status === 'suspended') await notify({ kind: 'subscription_cancelled', organization_id: org, access_until: updated.current_period_end });
		}
		return updated;
	};

	const findByProvider = (providerId: string | null, customId: string | null) => {
		const or: Record<string, unknown>[] = [];
		if (providerId) or.push({ provider_subscription_id: providerId });
		if (customId && Types.ObjectId.isValid(customId)) or.push({ _id: new Types.ObjectId(customId) });
		return or.length ? Subscription.findOne({ $or: or }).lean<ISubscription>() : Promise.resolve(null);
	};

	/** Re-reads the organization's newest PayPal subscription. */
	const sync = async (organizationId: Id): Promise<ISubscription | null> => {
		const sub = await Subscription.findOne({ organization_id: organizationId, billing_method: 'paypal', provider_subscription_id: { $type: 'string' } }).sort({ open: -1, created_at: -1 }).lean<ISubscription>();
		if (!sub) return null;
		const client = pp();
		if (!client.configured()) throw notConfigured();
		return applyPaypal(sub, await client.getSubscription(sub.provider_subscription_id as string));
	};

	/** A completed subscription payment (first or renewal): new period, invoice, monthly grant. */
	const recordPayment = async (sub: ISubscription, sale: { id: string; amount: number; currency: string; time: Date }) => {
		if (await Invoice.exists({ provider_ref: sale.id })) return null;
		const at = now();
		const first = !sub.last_payment_at;
		let periodStart = sub.current_period_start ?? sale.time;
		let periodEnd = sub.current_period_end;
		let quantity = sub.paid_quantity;
		let price = sub.price;
		let billed = sub.paid_quantity;
		if (!first) {
			periodStart = sub.current_period_end ?? sale.time;
			periodEnd = null;
			const nr = sub.next_renewal;
			if (nr && sub.current_period_end && nr.period_end.getTime() === sub.current_period_end.getTime()) {
				price = nr.price;
				billed = nr.quantity;
				quantity = nr.quantity + (nr.prepaid_quantity ?? 0);
			}
		}
		if (!periodEnd && sub.provider_subscription_id && pp().configured()) {
			try {
				const ps = await pp().getSubscription(sub.provider_subscription_id);
				if (ps.next_billing_time) periodEnd = new Date(ps.next_billing_time);
			} catch (err) {
				logger.warn(`billing: next_billing_time read failed for ${String(sub._id)}: ${(err as Error).message}`);
			}
		}
		if (!periodEnd || periodEnd <= periodStart) {
			periodEnd = new Date(periodStart);
			periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
		}
		const invoice = await invoiceService.issue({
			organization_id: sub.organization_id,
			subscription_id: sub._id,
			kind: 'subscription',
			status: 'paid',
			currency: sub.currency,
			lines: monthlyLines(price, billed),
			provider_ref: sale.id,
			charged_amount: sale.amount,
			period_start: periodStart,
			period_end: periodEnd,
			paid_at: sale.time,
		});
		await Subscription.updateOne(
			{ _id: sub._id },
			{
				$set: {
					status: sub.status === 'approval_pending' || sub.status === 'past_due' ? 'active' : sub.status,
					open: OPEN_STATUSES.includes(sub.status),
					current_period_start: periodStart,
					current_period_end: periodEnd,
					paid_quantity: quantity,
					price,
					next_renewal: null,
					past_due_since: null,
					failed_payments: 0,
					last_payment_at: sale.time,
					...(sub.started_at ? {} : { started_at: sale.time }),
				},
				...pushEvent(first ? 'first_payment' : 'renewal_payment', `${sale.currency} ${sale.amount.toFixed(2)}`, at),
			},
		);
		const grant = (await planForOrganization(await orgOf(sub.organization_id))).monthly_token_grant;
		await creditOnce(sub.organization_id, 'monthly_grant', grant, `grant:${sale.id}`, 'Monthly token grant', at);
		await notify({ kind: 'receipt', organization_id: String(sub.organization_id), invoice_id: String(invoice._id) });
		return invoice;
	};

	const paymentFailed = async (sub: ISubscription) => {
		const at = now();
		const since = sub.past_due_since ?? at;
		await Subscription.updateOne(
			{ _id: sub._id },
			{ $set: { status: sub.open ? 'past_due' : sub.status, past_due_since: since }, $inc: { failed_payments: 1 }, ...pushEvent('payment_failed', null, at) },
		);
		await notify({ kind: 'payment_failed', organization_id: String(sub.organization_id), grace_ends_at: new Date(since.getTime() + config.billing.graceDays * DAY) });
	};

	/** Cancels at PayPal; access runs to the end of the paid period. */
	const cancel = async (organizationId: Id, reason: string, actor: string) => {
		const sub = await Subscription.findOne({ organization_id: organizationId, open: true }).lean<ISubscription>();
		if (!sub) throw apiErrorWithData(httpStatus.CONFLICT, 'There is no subscription to cancel.', { reason: 'no_subscription' });
		if (sub.billing_method === 'manual') throw apiErrorWithData(httpStatus.CONFLICT, 'This organization is billed by invoice. Contact us to cancel.', { reason: 'manual_billing' });
		if (sub.provider_subscription_id && sub.status !== 'approval_pending') {
			const client = pp();
			if (!client.configured()) throw notConfigured();
			await client.cancelSubscription(sub.provider_subscription_id, reason || 'Cancelled by the customer');
		}
		const at = now();
		return Subscription.findByIdAndUpdate(
			sub._id,
			{ $set: { status: sub.status === 'approval_pending' ? 'expired' : 'cancelled', open: false, cancel_at_period_end: true, cancelled_at: at }, ...pushEvent('cancelled', actor, at) },
			{ new: true },
		).lean<ISubscription>();
	};

	return { checkout, applyPaypal, findByProvider, sync, recordPayment, paymentFailed, cancel };
};

const orgOf = async (id: Id) => (await Organization.findById(id).select({ plan_id: 1 }).lean<{ _id: Types.ObjectId; plan_id: Types.ObjectId | null }>()) ?? { _id: id, plan_id: null };

export type SubscriptionService = ReturnType<typeof createSubscriptionService>;
export const subscriptionService = createSubscriptionService();
