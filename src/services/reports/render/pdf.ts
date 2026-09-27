import path from 'path';
import PDFDocument from 'pdfkit';
import { DateTime } from 'luxon';
import { Block, ReportDocument } from '../types';
import { BUCKET_COLORS, BUCKET_LABELS, MUTED, TEXT, TONE_COLORS } from './theme';

// Reports center (Phase 12): renders a ReportDocument to PDF with PDFKit (pure Node, no browser).
// Charts and the grid heatmap are drawn as vectors. DejaVu Sans is embedded so accented and other
// non-Latin-1 names print correctly. Letter size (US/Canada).

const FONT_DIR = path.join(path.dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf');
const REGULAR = path.join(FONT_DIR, 'DejaVuSans.ttf');
const BOLD = path.join(FONT_DIR, 'DejaVuSans-Bold.ttf');

const MARGIN = 48;
const FOOTER_SPACE = 44;

export interface RenderOptions {
	/** Tests: record every string drawn (PDF text is glyph-encoded, so it can't be searched in the file). */
	collectText?: boolean;
}

export interface RenderedPdf {
	buffer: Buffer;
	pages: number;
	text: string[];
}

type Doc = PDFKit.PDFDocument;

export const renderPdf = (report: ReportDocument, opts: RenderOptions = {}): Promise<RenderedPdf> =>
	new Promise((resolve, reject) => {
		const brand = report.branding;
		const doc: Doc = new PDFDocument({
			size: 'LETTER',
			margins: { top: MARGIN, bottom: MARGIN + FOOTER_SPACE, left: MARGIN, right: MARGIN },
			bufferPages: true,
			info: { Title: `${report.title}: ${report.location.name}`, Author: brand.name, Creator: brand.hide_mypageseo ? brand.name : 'MyPageSEO', CreationDate: report.generated_at },
		});
		const chunks: Buffer[] = [];
		const text: string[] = [];
		doc.on('data', (c: Buffer) => chunks.push(c));
		doc.on('error', reject);
		doc.registerFont('R', REGULAR);
		doc.registerFont('B', BOLD);

		const W = doc.page.width - MARGIN * 2;
		const bottom = () => doc.page.height - MARGIN - FOOTER_SPACE;
		const log = (s: string) => {
			if (opts.collectText) text.push(s);
		};
		const write = (s: string, x: number, y: number, o: PDFKit.Mixins.TextOptions = {}) => {
			log(s);
			doc.text(s, x, y, o);
		};
		const ensure = (h: number) => {
			if (doc.y + h > bottom()) doc.addPage();
		};
		const gap = (h: number) => {
			doc.y += h;
		};

		// ---- header (first page) ----
		const bandH = 96;
		doc.rect(0, 0, doc.page.width, bandH).fill(brand.primary_color);
		let textX = MARGIN;
		if (brand.logo) {
			try {
				doc.image(Buffer.from(brand.logo.data_base64, 'base64'), MARGIN, 18, { fit: [120, 60], valign: 'center' });
				textX = MARGIN + 136;
			} catch {
				// An unreadable logo is left out rather than failing the report.
			}
		}
		doc.fillColor('#ffffff').font('B').fontSize(18);
		write(brand.name, textX, 30, { width: doc.page.width - textX - MARGIN, lineBreak: false, ellipsis: true });
		if (brand.contact_text) {
			doc.font('R').fontSize(9);
			write(brand.contact_text, textX, 56, { width: doc.page.width - textX - MARGIN, lineBreak: false, ellipsis: true });
		}
		doc.y = bandH + 28;
		doc.fillColor(TEXT).font('B').fontSize(22);
		write(report.title, MARGIN, doc.y, { width: W });
		doc.font('B').fontSize(14).fillColor(brand.secondary_color);
		write(report.location.name, MARGIN, doc.y + 4, { width: W });
		const loc = report.location;
		const address = [loc.address, loc.city, loc.state, loc.country].filter(Boolean).join(', ');
		doc.font('R').fontSize(10).fillColor(MUTED);
		const meta = [address, loc.client_name ? `Client: ${loc.client_name}` : null, report.period, `Generated ${DateTime.fromJSDate(report.generated_at, { zone: 'utc' }).toFormat('d LLL yyyy')}`].filter(
			(v): v is string => Boolean(v),
		);
		for (const line of meta) write(line, MARGIN, doc.y + 2, { width: W });
		gap(12);
		doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + W, doc.y).lineWidth(1).strokeColor('#e5e7eb').stroke();
		gap(14);

		// ---- blocks ----
		const heading = (b: Extract<Block, { kind: 'heading' }>) => {
			ensure(b.level === 1 ? 90 : 70);
			gap(b.level === 1 ? 4 : 8);
			doc.font('B').fontSize(b.level === 1 ? 18 : 13).fillColor(b.level === 1 ? brand.primary_color : TEXT);
			write(b.text, MARGIN, doc.y, { width: W });
			gap(6);
		};

		const paragraph = (b: Extract<Block, { kind: 'paragraph' }>) => {
			doc.font('R').fontSize(b.muted ? 9 : 10).fillColor(b.muted ? MUTED : TEXT);
			ensure(doc.heightOfString(b.text, { width: W }) + 4);
			write(b.text, MARGIN, doc.y, { width: W });
			gap(6);
		};

		const kpis = (b: Extract<Block, { kind: 'kpis' }>) => {
			const perRow = Math.min(4, Math.max(1, b.items.length));
			const g = 10;
			const bw = (W - g * (perRow - 1)) / perRow;
			const bh = 62;
			for (let i = 0; i < b.items.length; i += perRow) {
				ensure(bh + 8);
				const y = doc.y;
				b.items.slice(i, i + perRow).forEach((item, j) => {
					const x = MARGIN + j * (bw + g);
					doc.roundedRect(x, y, bw, bh, 4).fill('#f3f4f6');
					doc.font('R').fontSize(8).fillColor(MUTED);
					write(item.label, x + 10, y + 8, { width: bw - 20, lineBreak: false, ellipsis: true });
					doc.font('B').fontSize(16).fillColor(TEXT);
					write(item.value, x + 10, y + 21, { width: bw - 20, lineBreak: false, ellipsis: true });
					if (item.sub) {
						doc.font('R').fontSize(7.5).fillColor(TONE_COLORS[item.tone ?? 'neutral']);
						write(item.sub, x + 10, y + 44, { width: bw - 20, lineBreak: false, ellipsis: true });
					}
				});
				doc.y = y + bh + 8;
			}
			gap(4);
		};

		const table = (b: Extract<Block, { kind: 'table' }>) => {
			const weights = b.columns.map((c) => c.weight ?? 1);
			const total = weights.reduce((s, w) => s + w, 0);
			const widths = weights.map((w) => (w / total) * W);
			const pad = 5;
			const header = () => {
				const y = doc.y;
				doc.rect(MARGIN, y, W, 20).fill(brand.primary_color);
				doc.font('B').fontSize(8.5).fillColor('#ffffff');
				let x = MARGIN;
				b.columns.forEach((c, i) => {
					write(c.label, x + pad, y + 6, { width: widths[i] - pad * 2, align: c.align ?? 'left', lineBreak: false, ellipsis: true });
					x += widths[i];
				});
				doc.y = y + 20;
			};
			ensure(20 + 20);
			header();
			doc.font('R').fontSize(8.5);
			b.rows.forEach((row, r) => {
				const h = Math.max(18, ...row.map((cell, i) => doc.heightOfString(cell || ' ', { width: widths[i] - pad * 2 }) + 9));
				if (doc.y + h > bottom()) {
					doc.addPage();
					header();
					doc.font('R').fontSize(8.5);
				}
				const y = doc.y;
				const fill = b.highlight?.includes(r) ? '#fef3c7' : r % 2 ? '#f9fafb' : null;
				if (fill) doc.rect(MARGIN, y, W, h).fill(fill);
				doc.fillColor(TEXT);
				let x = MARGIN;
				row.forEach((cell, i) => {
					write(cell, x + pad, y + 5, { width: widths[i] - pad * 2, align: b.columns[i]?.align ?? 'left' });
					x += widths[i];
				});
				doc.y = y + h;
			});
			gap(10);
		};

		const lineChart = (b: Extract<Block, { kind: 'line_chart' }>) => {
			const h = 150;
			ensure(h + 50);
			doc.font('B').fontSize(9.5).fillColor(TEXT);
			write(b.title, MARGIN, doc.y, { width: W });
			gap(4);
			const top = doc.y;
			const left = MARGIN + 36;
			const cw = W - 44;
			const values = b.points.map((p) => p.value).filter((v): v is number => typeof v === 'number');
			let min = values.length ? Math.min(...values) : 0;
			let max = values.length ? Math.max(...values) : 1;
			if (min === max) {
				min -= 1;
				max += 1;
			}
			const yOf = (v: number) => (b.lower_is_better ? top + ((v - min) / (max - min)) * h : top + h - ((v - min) / (max - min)) * h);
			const xOf = (i: number) => left + (b.points.length === 1 ? cw / 2 : (i / (b.points.length - 1)) * cw);
			doc.lineWidth(0.5).strokeColor('#e5e7eb');
			doc.font('R').fontSize(7).fillColor(MUTED);
			for (let k = 0; k <= 4; k++) {
				const v = min + ((max - min) * k) / 4;
				const y = yOf(v);
				doc.moveTo(left, y).lineTo(left + cw, y).stroke();
				write(Number.isInteger(v) ? String(v) : v.toFixed(1), MARGIN, y - 4, { width: 30, align: 'right', lineBreak: false });
			}
			const pts = b.points.map((p, i) => (typeof p.value === 'number' ? { x: xOf(i), y: yOf(p.value) } : null));
			doc.lineWidth(1.8).strokeColor(brand.primary_color);
			let started = false;
			for (const p of pts) {
				if (!p) {
					started = false;
					continue;
				}
				if (!started) doc.moveTo(p.x, p.y);
				else doc.lineTo(p.x, p.y);
				started = true;
			}
			doc.stroke();
			for (const p of pts) if (p) doc.circle(p.x, p.y, 2.2).fill(brand.primary_color);
			const step = Math.max(1, Math.ceil(b.points.length / 6));
			doc.font('R').fontSize(7).fillColor(MUTED);
			b.points.forEach((p, i) => {
				if (i % step !== 0 && i !== b.points.length - 1) return;
				write(p.label, xOf(i) - 30, top + h + 5, { width: 60, align: 'center', lineBreak: false });
			});
			doc.y = top + h + 22;
		};

		const heatmap = (b: Extract<Block, { kind: 'heatmap' }>) => {
			const cell = Math.min(36, W / b.size);
			const gridW = cell * b.size;
			ensure(20 + gridW + 26);
			doc.font('B').fontSize(9.5).fillColor(TEXT);
			write(b.title, MARGIN, doc.y, { width: W });
			gap(4);
			const top = doc.y;
			for (const c of b.cells) {
				const x = MARGIN + c.col * cell;
				const y = top + c.row * cell;
				doc.rect(x + 1, y + 1, cell - 2, cell - 2).fill(BUCKET_COLORS[c.bucket]);
				doc.font('B').fontSize(cell > 28 ? 9 : 7).fillColor('#ffffff');
				write(c.text, x, y + cell / 2 - 5, { width: cell, align: 'center', lineBreak: false });
			}
			doc.y = top + gridW + 6;
			let x = MARGIN;
			doc.font('R').fontSize(7);
			for (const [key, label] of Object.entries(BUCKET_LABELS)) {
				doc.rect(x, doc.y + 1, 7, 7).fill(BUCKET_COLORS[key as keyof typeof BUCKET_COLORS]);
				doc.fillColor(MUTED);
				write(label, x + 10, doc.y, { lineBreak: false });
				x += 12 + doc.widthOfString(label) + 10;
			}
			gap(20);
		};

		const list = (b: Extract<Block, { kind: 'list' }>) => {
			doc.font('R').fontSize(10).fillColor(TEXT);
			for (const item of b.items) {
				ensure(doc.heightOfString(item, { width: W - 14 }) + 4);
				const y = doc.y;
				doc.circle(MARGIN + 4, y + 6, 1.8).fill(brand.secondary_color);
				doc.fillColor(TEXT);
				write(item, MARGIN + 14, y, { width: W - 14 });
				gap(3);
			}
			gap(6);
		};

		const unavailable = (b: Extract<Block, { kind: 'unavailable' }>) => {
			ensure(46);
			const y = doc.y;
			doc.roundedRect(MARGIN, y, W, 38, 4).fill('#f3f4f6');
			doc.font('R').fontSize(9.5).fillColor(MUTED);
			write(b.message, MARGIN + 12, y + 13, { width: W - 24, lineBreak: false, ellipsis: true });
			doc.y = y + 38;
			gap(10);
		};

		for (const b of report.blocks) {
			if (b.kind === 'heading') heading(b);
			else if (b.kind === 'paragraph') paragraph(b);
			else if (b.kind === 'kpis') kpis(b);
			else if (b.kind === 'table') table(b);
			else if (b.kind === 'line_chart') lineChart(b);
			else if (b.kind === 'heatmap') heatmap(b);
			else if (b.kind === 'list') list(b);
			else if (b.kind === 'unavailable') unavailable(b);
			else if (b.kind === 'page_break' && doc.y > MARGIN + 10) doc.addPage();
		}
		if (report.blocks.length === 0) paragraph({ kind: 'paragraph', text: 'No data for this report.', muted: true });

		// ---- footers ----
		const range = doc.bufferedPageRange();
		for (let i = range.start; i < range.start + range.count; i++) {
			doc.switchToPage(i);
			const saved = doc.page.margins.bottom;
			doc.page.margins.bottom = 0;
			const y = doc.page.height - MARGIN - 18;
			doc.moveTo(MARGIN, y - 6).lineTo(MARGIN + W, y - 6).lineWidth(0.5).strokeColor('#e5e7eb').stroke();
			doc.font('R').fontSize(7.5).fillColor(MUTED);
			write(brand.footer_text ?? brand.name, MARGIN, y, { width: W * 0.7, lineBreak: false, ellipsis: true });
			write(`Page ${i - range.start + 1} of ${range.count}`, MARGIN + W * 0.7, y, { width: W * 0.3, align: 'right', lineBreak: false });
			if (!brand.hide_mypageseo) write('Powered by MyPageSEO', MARGIN + W * 0.5, y + 11, { width: W * 0.5, align: 'right', lineBreak: false });
			doc.page.margins.bottom = saved;
		}
		const pages = range.count;
		doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), pages, text }));
		doc.end();
	});
