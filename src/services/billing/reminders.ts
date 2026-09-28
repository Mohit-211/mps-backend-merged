import config from '../../configs/config';
import logger from '../../configs/logger';
import { IInvoice, Invoice, IOrganization, Organization, Subscription } from '../../models';
import { notify } from './notify';

// Billing reminders (Phase 13a), run daily by billing-reminders: the trial ends in 3 days / 1 day (only
// for organizations without a subscription), and manual invoices past their due date (once each).

const DAY = 86_400_000;
const TRIAL_REMINDER_DAYS = [3, 1];

export const sendBillingReminders = async (now: Date = new Date()): Promise<{ trial: number; overdue: number }> => {
	let trial = 0;
	const soon = await Organization.find({ is_active: true, suspended_at: null, trial_ends_at: { $gt: now, $lte: new Date(now.getTime() + Math.max(...TRIAL_REMINDER_DAYS) * DAY) } }).lean<IOrganization[]>();
	for (const org of soon) {
		if (await Subscription.exists({ organization_id: org._id, status: { $in: ['active', 'past_due'] } })) continue;
		const ends = org.trial_ends_at as Date;
		const daysLeft = Math.ceil((ends.getTime() - now.getTime()) / DAY);
		const due = TRIAL_REMINDER_DAYS.filter((d) => daysLeft <= d);
		if (due.length === 0) continue;
		const days = Math.min(...due);
		const state = org.billing_reminders && new Date(org.billing_reminders.trial_ends_at ?? 0).getTime() === ends.getTime() ? org.billing_reminders : { trial_ends_at: ends, sent: [] };
		if (state.sent.includes(days)) continue;
		// Claim before sending (compare-and-set), so two processes don't send it twice.
		const claimed = await Organization.updateOne(
			{ _id: org._id, $or: [{ billing_reminders: null }, { 'billing_reminders.trial_ends_at': { $ne: ends } }, { 'billing_reminders.sent': { $ne: days } }] },
			{ $set: { billing_reminders: { trial_ends_at: ends, sent: [...state.sent, days] } } },
		);
		if (!claimed.modifiedCount) continue;
		await notify({ kind: 'trial_ending', organization_id: String(org._id), days, trial_ends_at: ends });
		trial += 1;
	}

	let overdue = 0;
	const late = await Invoice.find({ status: 'open', due_at: { $lt: now }, reminded_at: null }).limit(500).lean<IInvoice[]>();
	for (const inv of late) {
		const claimed = await Invoice.updateOne({ _id: inv._id, reminded_at: null }, { $set: { reminded_at: now } });
		if (!claimed.modifiedCount) continue;
		await notify({ kind: 'invoice_overdue', organization_id: String(inv.organization_id), invoice_id: String(inv._id) });
		overdue += 1;
	}
	logger.info(`billing-reminders: trial=${trial} overdue=${overdue} (grace ${config.billing.graceDays} days)`);
	return { trial, overdue };
};
