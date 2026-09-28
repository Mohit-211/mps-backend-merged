import { Types } from 'mongoose';
import config from '../../configs/config';
import logger from '../../configs/logger';
import { IInvoice, Invoice, IOrganization, Organization, User } from '../../models';
import { sendBillingEmail } from '../common/email.service';
import { maskEmail } from '../team/invitation.service';
import { invoiceService } from './invoices';
import type { BillingNotice } from './notify';

// Billing emails (Phase 13a). Sent to the billing email (billing details), else the owner. Invoices are
// attached as PDF. In development nothing is sent: the notice is logged with the address masked.

const esc = (v: string) => v.replace(/[<>&"]/g, '');
const day = (d: Date | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const money = (inv: Pick<IInvoice, 'currency' | 'total'>) => `${inv.currency} ${inv.total.toFixed(2)}`;
const billingUrl = () => `${(config.auth.frontendUrl || '').replace(/\/$/, '')}/settings/billing`;

const recipientOf = async (org: IOrganization): Promise<string | null> => {
	if (org.billing_details?.email) return org.billing_details.email;
	const owner = await User.findById(org.owner_user_id).select({ email: 1 }).lean<{ email?: string }>();
	return owner?.email ?? null;
};

interface Mail {
	subject: string;
	lines: string[];
	invoice?: IInvoice | null;
}

const compose = async (n: BillingNotice, org: IOrganization): Promise<Mail | null> => {
	const name = org.name;
	const invoice = 'invoice_id' in n && Types.ObjectId.isValid(n.invoice_id) ? await Invoice.findById(n.invoice_id).lean<IInvoice>() : null;
	switch (n.kind) {
		case 'receipt':
			return invoice ? { subject: `Receipt ${invoice.number} - MyPageSEO`, lines: [`Thank you. We received your payment of ${money(invoice)} for ${name}.`, `Invoice ${invoice.number} is attached.`], invoice } : null;
		case 'invoice_issued':
			return invoice
				? { subject: `Invoice ${invoice.number} - MyPageSEO`, lines: [`A new invoice for ${name}: ${money(invoice)}, due ${day(invoice.due_at)}.`, 'The invoice is attached.'], invoice }
				: null;
		case 'invoice_overdue':
			return invoice
				? {
						subject: `Invoice ${invoice.number} is overdue - MyPageSEO`,
						lines: [`Invoice ${invoice.number} for ${name} (${money(invoice)}) was due on ${day(invoice.due_at)}.`, `Please pay within ${config.billing.graceDays} days of the due date to keep full access.`],
						invoice,
					}
				: null;
		case 'payment_failed':
			return {
				subject: 'Your MyPageSEO payment failed',
				lines: [`We couldn't collect the subscription payment for ${name}. PayPal will retry.`, `Please check your PayPal payment method${n.grace_ends_at ? ` before ${day(n.grace_ends_at)}` : ''}; after that the account becomes read-only.`],
			};
		case 'subscription_cancelled':
			return { subject: 'Your MyPageSEO subscription was cancelled', lines: [`The subscription for ${name} was cancelled.`, n.access_until ? `You keep full access until ${day(n.access_until)}.` : ''] };
		case 'subscription_activated':
			return { subject: 'Your MyPageSEO subscription is active', lines: [`The subscription for ${name} is active. Thank you.`] };
		case 'trial_ending':
			return {
				subject: `Your MyPageSEO trial ends in ${n.days} day${n.days === 1 ? '' : 's'}`,
				lines: [`The free trial for ${name} ends on ${day(n.trial_ends_at)}.`, 'Subscribe to keep your monthly rankings, GBP reports and scheduled reports running.'],
			};
		default:
			return null;
	}
};

/** Sends one billing notice. Throws on a send failure (notify() catches). */
export const sendBillingNotice = async (n: BillingNotice): Promise<void> => {
	const org = await Organization.findById(n.organization_id).lean<IOrganization>();
	if (!org) return;
	const mail = await compose(n, org);
	const to = await recipientOf(org);
	if (!mail || !to) return;
	const lines = [...mail.lines.filter(Boolean), `Billing: ${billingUrl()}`];
	if (config.essentials.env === 'development' || config.essentials.env === 'test') {
		logger.info(`billing email (not sent in ${config.essentials.env}) "${mail.subject}" to ${maskEmail(to)}`);
		return;
	}
	const pdf = mail.invoice ? await invoiceService.readPdf(mail.invoice) : null;
	await sendBillingEmail({
		to,
		subject: mail.subject,
		text: lines.join('\n\n'),
		html: lines.map((l) => `<p>${esc(l)}</p>`).join(''),
		attachment: pdf && mail.invoice ? { filename: `${mail.invoice.number}.pdf`, content: pdf } : null,
	});
};
