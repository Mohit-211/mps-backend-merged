import { Types } from 'mongoose';
import config from '../../configs/config';
import logger from '../../configs/logger';
import { monthlyAmount, monthlyLines, priceAt, Price } from '../../billing/pricing';
import { ISubscription, ITokenLedger, Location, Organization, Subscription, TokenLedger } from '../../models';
import { invoiceService } from './invoices';
import { notify } from './notify';
import { planForOrganization } from './plans';
import { paymentProvider } from './providers';
import { BillingDeps } from './subscriptions';
import { credit, creditOnce } from './tokens';

// Renewals (Phase 13a), run by the billing-renewals job every 6 hours.
// - Online (provider) billing: the provider's renewalLeadDays before each renewal (PayPal: 11, since it
//   ignores price changes within 10 days) the renewal is
//   fixed: quantity = the active locations (at least 1), prices in effect at the renewal date, and the
//   subscription's price override is PATCHed to that amount.
// - Manual billing: at each period end the next period starts and an open invoice is issued (due in
//   MANUAL_INVOICE_DUE_DAYS), with the prorated slot lines added since the last invoice. Comped
//   subscriptions advance without an invoice.
// - Token packs with an expiry: what is left of the pack (oldest tokens are spent first) expires.

const DAY = 86_400_000;
const addMonth = (d: Date): Date => {
	const n = new Date(d);
	n.setUTCMonth(n.getUTCMonth() + 1);
	return n;
};
const push = (type: string, detail: string | null, at: Date) => ({ $push: { events: { $each: [{ at, type, detail }], $slice: -50 } } });

const orgPlan = async (organizationId: Types.ObjectId) => {
	const org = await Organization.findById(organizationId).select({ plan_id: 1 }).lean<{ _id: Types.ObjectId; plan_id: Types.ObjectId | null }>();
	return planForOrganization(org ?? { _id: organizationId, plan_id: null });
};
const activeLocations = (organizationId: Types.ObjectId) => Location.countDocuments({ organization_id: organizationId, is_active: true });

export interface RenewalResult {
	snapshots: number;
	patch_errors: number;
	manual_invoices: number;
	manual_advanced: number;
	tokens_expired: number;
}

export const createRenewalService = (deps: BillingDeps = {}) => {
	const pp = deps.provider ?? paymentProvider;
	const now = deps.now ?? (() => new Date());

	const snapshotPaypal = async (at: Date, result: RenewalResult) => {
		const provider = pp();
		const horizon = new Date(at.getTime() + provider.renewalLeadDays * DAY);
		const subs = await Subscription.find({
			billing_method: provider.name,
			open: true,
			status: { $in: ['active', 'past_due'] },
			provider_subscription_id: { $type: 'string' },
			current_period_end: { $gt: at, $lte: horizon },
		}).lean<ISubscription[]>();
		for (const sub of subs) {
			const end = sub.current_period_end as Date;
			if (sub.next_renewal && sub.next_renewal.period_end.getTime() === end.getTime()) continue;
			const plan = await orgPlan(sub.organization_id);
			const quantity = Math.max(1, await activeLocations(sub.organization_id));
			const price: Price = priceAt(plan.prices, sub.currency, end) ?? sub.price;
			const amount = monthlyAmount(price, quantity);
			if (!provider.configured()) {
				logger.warn(`billing: renewal snapshot for ${String(sub._id)} skipped: ${provider.name} is not configured`);
				result.patch_errors += 1;
				continue;
			}
			try {
				await provider.setRenewalAmount(sub.provider_subscription_id as string, amount, sub.currency);
			} catch (err) {
				// Not stored: the next run (6 h later) tries again while there is still time.
				logger.error(`billing: renewal price PATCH failed for ${String(sub._id)}: ${(err as Error).message}`);
				result.patch_errors += 1;
				continue;
			}
			const done = await Subscription.updateOne(
				{ _id: sub._id, current_period_end: end },
				{ $set: { next_renewal: { period_end: end, quantity, price, amount, fixed_at: at, prepaid_quantity: 0 } }, ...push('renewal_fixed', `${quantity} location(s), ${sub.currency} ${amount.toFixed(2)}`, at) },
			);
			if (done.modifiedCount) result.snapshots += 1;
		}
	};

	const renewManual = async (at: Date, result: RenewalResult) => {
		const subs = await Subscription.find({ billing_method: 'manual', open: true, status: { $in: ['active', 'past_due'] }, current_period_end: { $lte: at } }).lean<ISubscription[]>();
		for (const first of subs) {
			let sub: ISubscription | null = first;
			// Catch up at most 3 missed periods per run.
			for (let i = 0; i < 3 && sub && sub.current_period_end && sub.current_period_end <= at; i += 1) {
				const start = sub.current_period_end;
				const end = addMonth(start);
				const plan = await orgPlan(sub.organization_id);
				const quantity = Math.max(1, await activeLocations(sub.organization_id));
				const price: Price = priceAt(plan.prices, sub.currency, start) ?? sub.price;
				const comped = Boolean(sub.comp_until && sub.comp_until > start);
				const pending = sub.pending_lines ?? [];
				const next: ISubscription | null = await Subscription.findOneAndUpdate(
					{ _id: sub._id, current_period_end: start },
					{
						$set: { current_period_start: start, current_period_end: end, paid_quantity: quantity, price, pending_lines: [], next_renewal: null },
						...push(comped ? 'period_comped' : 'period_invoiced', `${quantity} location(s)`, at),
					},
					{ new: true },
				).lean<ISubscription>();
				if (!next) break; // another process advanced it
				result.manual_advanced += 1;
				if (!comped) {
					const invoice = await invoiceService.issue({
						organization_id: sub.organization_id,
						subscription_id: sub._id,
						kind: 'manual',
						status: 'open',
						currency: sub.currency,
						lines: [...pending, ...monthlyLines(price, quantity)],
						provider_ref: `manual:${String(sub._id)}:${start.toISOString()}`,
						period_start: start,
						period_end: end,
						due_at: new Date(start.getTime() + config.billing.manualInvoiceDueDays * DAY),
					});
					result.manual_invoices += 1;
					await notify({ kind: 'invoice_issued', organization_id: String(sub.organization_id), invoice_id: String(invoice._id) });
				}
				await creditOnce(sub.organization_id, 'monthly_grant', plan.monthly_token_grant, `grant:${String(sub._id)}:${start.toISOString()}`, 'Monthly token grant', at);
				sub = next;
			}
		}
	};

	/** Expires what is left of each expired pack. Tokens are spent oldest first, so the balance holds the
	 * newest tokens: the pack's remainder = clamp(balance − credits added after it, 0, pack size). */
	const expireTokens = async (at: Date, result: RenewalResult) => {
		const due = await TokenLedger.find({ type: 'purchase', expires_at: { $ne: null, $lte: at } }).sort({ at: 1 }).limit(500).lean<ITokenLedger[]>();
		for (const p of due) {
			const ref = `expiry:${String(p._id)}`;
			if (await TokenLedger.exists({ ref, type: 'expiry' })) continue;
			const later = await TokenLedger.aggregate<{ total: number }>([
				{ $match: { organization_id: p.organization_id, at: { $gt: p.at }, amount: { $gt: 0 } } },
				{ $group: { _id: null, total: { $sum: '$amount' } } },
			]);
			const balance = (await Organization.findById(p.organization_id).select({ token_balance: 1 }).lean<{ token_balance?: number }>())?.token_balance ?? 0;
			const remainder = Math.max(0, Math.min(p.amount, balance - (later[0]?.total ?? 0)));
			try {
				if (remainder > 0) {
					await credit(p.organization_id, 'expiry', -remainder, { ref, note: 'Token pack expired' }, at);
					result.tokens_expired += remainder;
				} else {
					await TokenLedger.create({ organization_id: p.organization_id, type: 'expiry', amount: 0, balance_after: balance, ref, note: 'Token pack expired (already used)', at });
				}
			} catch (err) {
				if ((err as { code?: number }).code !== 11000) throw err;
			}
		}
	};

	const run = async (): Promise<RenewalResult> => {
		const at = now();
		const result: RenewalResult = { snapshots: 0, patch_errors: 0, manual_invoices: 0, manual_advanced: 0, tokens_expired: 0 };
		await snapshotPaypal(at, result);
		await renewManual(at, result);
		await expireTokens(at, result);
		logger.info(`billing-renewals: ${JSON.stringify(result)}`);
		return result;
	};

	return { run, snapshotPaypal, renewManual, expireTokens };
};

export const renewalService = createRenewalService();
