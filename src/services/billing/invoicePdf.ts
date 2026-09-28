import path from 'path';
import PDFDocument from 'pdfkit';
import { DateTime } from 'luxon';
import { IInvoice } from '../../models';

// Invoice PDF (Phase 13a): PDFKit with the reports' DejaVu fonts. Seller and customer blocks are the
// frozen copies on the invoice; no tax lines (the `tax_lines` table prints only when it has rows).

const FONT_DIR = path.join(path.dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf');
const TEXT = '#1f2937';
const MUTED = '#6b7280';
const LINE = '#e5e7eb';

const fmt = (n: number, currency: string): string => `${currency} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d: Date | null | undefined): string => (d ? DateTime.fromJSDate(new Date(d), { zone: 'utc' }).toFormat('d LLL yyyy') : '-');

type Invoiceish = Pick<IInvoice, 'number' | 'status' | 'currency' | 'lines' | 'tax_lines' | 'total' | 'issued_at' | 'due_at' | 'paid_at' | 'period_start' | 'period_end' | 'customer' | 'seller' | 'kind'>;

export const renderInvoicePdf = (inv: Invoiceish): Promise<Buffer> =>
	new Promise((resolve, reject) => {
		const doc = new PDFDocument({ size: 'LETTER', margin: 54, info: { Title: `Invoice ${inv.number}`, Author: inv.seller?.name ?? 'MyPageSEO' } });
		const chunks: Buffer[] = [];
		doc.on('data', (c: Buffer) => chunks.push(c));
		doc.on('end', () => resolve(Buffer.concat(chunks)));
		doc.on('error', reject);
		doc.registerFont('R', path.join(FONT_DIR, 'DejaVuSans.ttf'));
		doc.registerFont('B', path.join(FONT_DIR, 'DejaVuSans-Bold.ttf'));
		const left = 54;
		const right = doc.page.width - 54;

		doc.font('B').fontSize(20).fillColor(TEXT).text(inv.seller?.name ?? 'MyPageSEO', left, 54);
		doc.font('R').fontSize(9).fillColor(MUTED);
		for (const l of [...(inv.seller?.address ?? []), inv.seller?.email ?? '', inv.seller?.tax_id ? `Tax ID: ${inv.seller.tax_id}` : ''].filter(Boolean)) doc.text(l);
		doc.font('B').fontSize(16).fillColor(TEXT).text(inv.status === 'open' ? 'INVOICE' : inv.status === 'paid' ? 'INVOICE (PAID)' : `INVOICE (${inv.status.toUpperCase()})`, left, 54, { width: right - left, align: 'right' });
		doc.font('R').fontSize(10).fillColor(TEXT);
		const meta = [`No. ${inv.number}`, `Issued ${day(inv.issued_at)}`, inv.due_at ? `Due ${day(inv.due_at)}` : '', inv.paid_at ? `Paid ${day(inv.paid_at)}` : ''].filter(Boolean);
		for (const m of meta) doc.text(m, { width: right - left, align: 'right' });

		doc.moveDown(2);
		doc.font('B').fontSize(10).fillColor(MUTED).text('BILL TO', left);
		doc.font('R').fontSize(10).fillColor(TEXT);
		for (const l of [inv.customer?.name ?? '', ...(inv.customer?.address ?? []), inv.customer?.email ?? ''].filter(Boolean)) doc.text(l, left);
		if (inv.period_start && inv.period_end) {
			doc.moveDown(0.5).fillColor(MUTED).fontSize(9).text(`Service period: ${day(inv.period_start)} to ${day(inv.period_end)}`, left);
		}

		doc.moveDown(1.5);
		const cols = [left, left + 270, left + 330, left + 420];
		const header = (y: number) => {
			doc.font('B').fontSize(9).fillColor(MUTED);
			doc.text('Description', cols[0], y).text('Qty', cols[1], y, { width: 50, align: 'right' }).text('Unit price', cols[2], y, { width: 80, align: 'right' }).text('Amount', cols[3], y, { width: right - cols[3], align: 'right' });
			doc.moveTo(left, y + 14).lineTo(right, y + 14).strokeColor(LINE).stroke();
		};
		let y = doc.y;
		header(y);
		y += 22;
		doc.font('R').fontSize(10).fillColor(TEXT);
		for (const line of [...inv.lines, ...inv.tax_lines]) {
			doc.text(line.label, cols[0], y, { width: 260 });
			const h = Math.max(14, doc.heightOfString(line.label, { width: 260 }));
			doc.text(String(line.quantity), cols[1], y, { width: 50, align: 'right' });
			doc.text(fmt(line.unit_price, inv.currency), cols[2], y, { width: 80, align: 'right' });
			doc.text(fmt(line.amount, inv.currency), cols[3], y, { width: right - cols[3], align: 'right' });
			y += h + 8;
		}
		doc.moveTo(left, y).lineTo(right, y).strokeColor(LINE).stroke();
		y += 10;
		doc.font('B').fontSize(12).text('Total', cols[2], y, { width: 80, align: 'right' }).text(fmt(inv.total, inv.currency), cols[3], y, { width: right - cols[3], align: 'right' });
		doc.font('R').fontSize(9).fillColor(MUTED).text(inv.kind === 'manual' ? 'Payment by bank transfer or as agreed.' : 'Paid with PayPal.', left, y + 30);
		doc.end();
	});
