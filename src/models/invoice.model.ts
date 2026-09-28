import { Document, Model, Schema, Types, model } from 'mongoose';
import { CURRENCIES, Currency, INVOICE_KINDS, INVOICE_STATUSES, InvoiceKind, InvoiceStatus } from '../billing/constants';

// Invoices (Phase 13a): numbered INV-YYYY-NNNNNN, one per payment (subscription renewal, prorated
// location slots, token pack) or per manual-billing period. `tax_lines` stays empty (no tax yet).

export interface InvoiceLine {
	label: string;
	quantity: number;
	unit_price: number;
	amount: number;
}

export interface InvoiceParty {
	name: string | null;
	email: string | null;
	address: string[];
}

export interface IInvoice extends Document {
	_id: Types.ObjectId;
	number: string;
	organization_id: Types.ObjectId;
	subscription_id: Types.ObjectId | null;
	kind: InvoiceKind;
	status: InvoiceStatus;
	currency: Currency;
	lines: InvoiceLine[];
	tax_lines: InvoiceLine[];
	total: number;
	/** What the provider actually charged, when it differs from `total` (flagged for the admin). */
	charged_amount: number | null;
	mismatch: boolean;
	period_start: Date | null;
	period_end: Date | null;
	issued_at: Date;
	due_at: Date | null;
	paid_at: Date | null;
	provider_ref: string | null;
	payment_note: string | null;
	/** Manual invoices: when the overdue reminder was sent. */
	reminded_at: Date | null;
	customer: InvoiceParty;
	seller: InvoiceParty & { tax_id: string | null };
	pdf: { file: string; bytes: number } | null;
	created_at: Date;
	updated_at: Date;
}

const LineSchema = new Schema<InvoiceLine>({ label: String, quantity: Number, unit_price: Number, amount: Number }, { _id: false });

const InvoiceSchema = new Schema<IInvoice>(
	{
		number: { type: String, required: true },
		organization_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
		subscription_id: { type: Schema.Types.ObjectId, ref: 'Subscription', default: null },
		kind: { type: String, enum: INVOICE_KINDS, required: true },
		status: { type: String, enum: INVOICE_STATUSES, default: 'paid' },
		currency: { type: String, enum: CURRENCIES, required: true },
		lines: { type: [LineSchema], default: [] },
		tax_lines: { type: [LineSchema], default: [] },
		total: { type: Number, required: true },
		charged_amount: { type: Number, default: null },
		mismatch: { type: Boolean, default: false },
		period_start: { type: Date, default: null },
		period_end: { type: Date, default: null },
		issued_at: { type: Date, required: true },
		due_at: { type: Date, default: null },
		paid_at: { type: Date, default: null },
		provider_ref: { type: String, default: null },
		payment_note: { type: String, default: null },
		reminded_at: { type: Date, default: null },
		customer: { name: String, email: String, address: { type: [String], default: [] } },
		seller: { name: String, email: String, address: { type: [String], default: [] }, tax_id: { type: String, default: null } },
		pdf: { type: new Schema({ file: String, bytes: Number }, { _id: false }), default: null },
	},
	{ collection: 'invoices', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);
InvoiceSchema.index({ number: 1 }, { unique: true });
InvoiceSchema.index({ provider_ref: 1 }, { unique: true, partialFilterExpression: { provider_ref: { $type: 'string' } } });
InvoiceSchema.index({ organization_id: 1, issued_at: -1 });
InvoiceSchema.index({ status: 1, due_at: 1 });

export const Invoice: Model<IInvoice> = model<IInvoice>('Invoice', InvoiceSchema);
