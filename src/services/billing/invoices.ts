import path from 'path';
import { Types } from 'mongoose';
import config from '../../configs/config';
import logger from '../../configs/logger';
import { Currency, InvoiceKind, InvoiceStatus } from '../../billing/constants';
import { money } from '../../billing/pricing';
import { Counter, IInvoice, InvoiceLine, InvoiceParty, IOrganization, Invoice, Organization, User } from '../../models';
import { ReportStorage, reportStorage } from '../reports/storage';
import { renderInvoicePdf } from './invoicePdf';

// Invoices (Phase 13a): numbered INV-YYYY-NNNNNN from a per-year counter, one per payment (idempotent on
// the provider reference), customer and seller frozen at issue, PDF in the private reports storage.

type Id = Types.ObjectId | string;

export const nextInvoiceNumber = async (at: Date = new Date()): Promise<string> => {
	const year = at.getUTCFullYear();
	const row = await Counter.findOneAndUpdate({ key: `invoice:${year}` }, { $inc: { value: 1 } }, { upsert: true, new: true }).lean<{ value: number }>();
	return `INV-${year}-${String(row?.value ?? 1).padStart(6, '0')}`;
};

export const sellerParty = (): InvoiceParty & { tax_id: string | null } => ({
	name: config.billing.seller.name || 'MyPageSEO',
	email: config.billing.seller.email || null,
	address: (config.billing.seller.address || '').split('|').map((l) => l.trim()).filter(Boolean),
	tax_id: config.billing.seller.taxId || null,
});

export const customerParty = async (org: IOrganization): Promise<InvoiceParty> => {
	const d = org.billing_details;
	const owner = await User.findById(org.owner_user_id).select({ email: 1 }).lean<{ email: string }>();
	return {
		name: d?.name || org.name,
		email: d?.email || owner?.email || null,
		address: [d?.address_line1, d?.address_line2, [d?.city, d?.region, d?.postal_code].filter(Boolean).join(' '), d?.country].filter((l): l is string => Boolean(l && l.trim())),
	};
};

export const invoicePdfPath = (storage: ReportStorage, organizationId: Id, invoiceId: Id): string => path.join(storage.root, 'invoices', String(organizationId), `${String(invoiceId)}.pdf`);

export interface IssueInput {
	organization_id: Id;
	kind: InvoiceKind;
	status: InvoiceStatus;
	currency: Currency;
	lines: InvoiceLine[];
	subscription_id?: Id | null;
	provider_ref?: string | null;
	period_start?: Date | null;
	period_end?: Date | null;
	due_at?: Date | null;
	paid_at?: Date | null;
	/** What the provider actually charged (the invoice total is the lines' sum). */
	charged_amount?: number | null;
}

export const createInvoiceService = (deps: { storage?: ReportStorage; now?: () => Date } = {}) => {
	const storage = deps.storage ?? reportStorage;
	const now = deps.now ?? (() => new Date());

	const renderAndStore = async (invoice: IInvoice): Promise<void> => {
		try {
			const pdf = await renderInvoicePdf(invoice);
			const file = invoicePdfPath(storage, invoice.organization_id, invoice._id);
			await storage.write(file, pdf);
			await Invoice.updateOne({ _id: invoice._id }, { $set: { pdf: { file: path.basename(file), bytes: pdf.length } } });
		} catch (err) {
			logger.error(`billing: invoice ${invoice.number} PDF failed: ${(err as Error).message}`);
		}
	};

	/** Issues an invoice; with a provider_ref an existing one is returned instead (webhook retries). */
	const issue = async (input: IssueInput): Promise<IInvoice> => {
		if (input.provider_ref) {
			const existing = await Invoice.findOne({ provider_ref: input.provider_ref }).lean<IInvoice>();
			if (existing) return existing;
		}
		const org = (await Organization.findById(input.organization_id).lean<IOrganization>()) as IOrganization;
		const at = now();
		const total = money(input.lines.reduce((s, l) => s + l.amount, 0));
		const charged = input.charged_amount ?? null;
		let invoice: IInvoice;
		try {
			invoice = (
				await Invoice.create({
					number: await nextInvoiceNumber(at),
					organization_id: input.organization_id,
					subscription_id: input.subscription_id ?? null,
					kind: input.kind,
					status: input.status,
					currency: input.currency,
					lines: input.lines,
					tax_lines: [],
					total,
					charged_amount: charged,
					mismatch: charged !== null && money(charged) !== total,
					period_start: input.period_start ?? null,
					period_end: input.period_end ?? null,
					issued_at: at,
					due_at: input.due_at ?? null,
					paid_at: input.paid_at ?? (input.status === 'paid' ? at : null),
					provider_ref: input.provider_ref ?? null,
					customer: await customerParty(org),
					seller: sellerParty(),
				})
			).toObject() as IInvoice;
		} catch (err) {
			// Two deliveries of the same event raced: the other one issued it.
			if ((err as { code?: number }).code === 11000 && input.provider_ref) return (await Invoice.findOne({ provider_ref: input.provider_ref }).lean<IInvoice>()) as IInvoice;
			throw err;
		}
		if (invoice.mismatch) logger.warn(`billing: invoice ${invoice.number} charged ${charged} vs expected ${total} (flagged)`);
		await renderAndStore(invoice);
		return (await Invoice.findById(invoice._id).lean<IInvoice>()) as IInvoice;
	};

	const markPaid = async (invoiceId: Id, note: string | null): Promise<IInvoice | null> => {
		const res = await Invoice.findOneAndUpdate({ _id: invoiceId, status: 'open' }, { $set: { status: 'paid', paid_at: now(), payment_note: note } }, { new: true }).lean<IInvoice>();
		if (res) await renderAndStore(res);
		return res;
	};

	const setStatus = async (filter: Record<string, unknown>, status: InvoiceStatus, note: string | null): Promise<IInvoice | null> => {
		const res = await Invoice.findOneAndUpdate(filter, { $set: { status, payment_note: note } }, { new: true }).lean<IInvoice>();
		if (res) await renderAndStore(res);
		return res;
	};

	const readPdf = async (invoice: IInvoice): Promise<Buffer | null> => {
		const file = invoicePdfPath(storage, invoice.organization_id, invoice._id);
		const existing = await storage.read(file);
		if (existing) return existing;
		await renderAndStore(invoice);
		return storage.read(file);
	};

	return { issue, markPaid, setStatus, readPdf };
};

export const invoiceService = createInvoiceService();

export const invoiceView = (i: IInvoice) => ({
	id: String(i._id),
	number: i.number,
	kind: i.kind,
	status: i.status,
	currency: i.currency,
	lines: i.lines,
	tax_lines: i.tax_lines,
	total: i.total,
	charged_amount: i.charged_amount,
	period_start: i.period_start,
	period_end: i.period_end,
	issued_at: i.issued_at,
	due_at: i.due_at,
	paid_at: i.paid_at,
	has_pdf: Boolean(i.pdf),
});
