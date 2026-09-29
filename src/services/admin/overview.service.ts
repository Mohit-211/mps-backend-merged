import { EntitlementState } from '../../billing/constants';
import { monthlyAmount, money } from '../../billing/pricing';
import { IOrganization, ISubscription, Invoice, Organization, Subscription, User } from '../../models';
import { loadEntitlement } from '../billing/entitlement.service';
import { openTicketCount } from '../support/tickets.service';

// Admin overview (Phase 13b): the platform at a glance. MRR per currency is what the open paid
// subscriptions charge per month (first + (paid − 1) × additional; comped ones excluded).

const DAY = 86_400_000;

export const adminOverview = async (now: Date = new Date()) => {
	const since = new Date(now.getTime() - 30 * DAY);
	const orgs = await Organization.find({ is_active: true }).lean<IOrganization[]>();
	const byType: Record<string, number> = {};
	const byState: Record<string, number> = {};
	let trialsEnding = 0;
	for (const org of orgs) {
		byType[org.type] = (byType[org.type] ?? 0) + 1;
		const e = (await loadEntitlement(org, now)).entitlement;
		byState[e.state] = (byState[e.state] ?? 0) + 1;
		if (e.state === 'trialing' && org.trial_ends_at && org.trial_ends_at.getTime() - now.getTime() <= 7 * DAY) trialsEnding += 1;
	}
	const subs = await Subscription.find({ open: true, status: { $in: ['active', 'past_due'] } }).lean<ISubscription[]>();
	const mrr: Record<string, number> = {};
	let paid = 0;
	for (const s of subs) {
		if (s.comp_until && s.comp_until > now) continue;
		paid += 1;
		mrr[s.currency] = money((mrr[s.currency] ?? 0) + monthlyAmount(s.price, s.paid_quantity));
	}
	const tokenSales = await Invoice.aggregate<{ _id: string; count: number; total: number }>([
		{ $match: { kind: 'token_pack', status: 'paid', paid_at: { $gte: since } } },
		{ $group: { _id: '$currency', count: { $sum: 1 }, total: { $sum: '$total' } } },
	]);
	const [signups, newOrgs, openTickets] = await Promise.all([
		User.countDocuments({ created_at: { $gte: since }, email_verified_at: { $ne: null } }),
		Organization.countDocuments({ created_at: { $gte: since } }),
		openTicketCount(),
	]);
	return {
		organizations: { total: orgs.length, by_type: byType, by_state: byState as Partial<Record<EntitlementState, number>> },
		subscriptions: { paying: paid, past_due: subs.filter((s) => s.status === 'past_due').length, mrr },
		trials_ending_7d: trialsEnding,
		token_sales_30d: Object.fromEntries(tokenSales.map((t) => [t._id, { count: t.count, total: money(t.total) }])),
		signups_30d: { users: signups, organizations: newOrgs },
		open_tickets: openTickets,
		generated_at: now,
	};
};
