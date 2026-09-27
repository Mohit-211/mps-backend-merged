import { DateTime } from 'luxon';
import { Block, ReportDocument } from '../types';
import { BUCKET_COLORS, BUCKET_LABELS, MUTED, TEXT, TONE_COLORS } from './theme';

// Reports center (Phase 12): renders a ReportDocument to a standalone HTML page (the public share
// view) and to a short email summary. No scripts, no external resources: styles are inline, charts
// are inline SVG, the logo is a data: URI. Every value is escaped.

export const escapeHtml = (s: string): string =>
	s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const e = escapeHtml;

const lineChartSvg = (b: Extract<Block, { kind: 'line_chart' }>, color: string): string => {
	const w = 640;
	const h = 180;
	const left = 40;
	const top = 10;
	const cw = w - left - 10;
	const ch = h - 40;
	const values = b.points.map((p) => p.value).filter((v): v is number => typeof v === 'number');
	let min = values.length ? Math.min(...values) : 0;
	let max = values.length ? Math.max(...values) : 1;
	if (min === max) {
		min -= 1;
		max += 1;
	}
	const yOf = (v: number) => (b.lower_is_better ? top + ((v - min) / (max - min)) * ch : top + ch - ((v - min) / (max - min)) * ch);
	const xOf = (i: number) => left + (b.points.length === 1 ? cw / 2 : (i / (b.points.length - 1)) * cw);
	const grid = [0, 1, 2, 3, 4]
		.map((k) => {
			const v = min + ((max - min) * k) / 4;
			const y = yOf(v).toFixed(1);
			return `<line x1="${left}" x2="${left + cw}" y1="${y}" y2="${y}" stroke="#e5e7eb"/><text x="${left - 6}" y="${y}" font-size="10" fill="${MUTED}" text-anchor="end" dominant-baseline="middle">${Number.isInteger(v) ? v : v.toFixed(1)}</text>`;
		})
		.join('');
	const path = b.points
		.map((p, i) => (typeof p.value === 'number' ? `${xOf(i).toFixed(1)},${yOf(p.value).toFixed(1)}` : null))
		.filter(Boolean)
		.join(' ');
	const step = Math.max(1, Math.ceil(b.points.length / 6));
	const labels = b.points
		.map((p, i) =>
			i % step === 0 || i === b.points.length - 1 ? `<text x="${xOf(i).toFixed(1)}" y="${h - 8}" font-size="10" fill="${MUTED}" text-anchor="middle">${e(p.label)}</text>` : '',
		)
		.join('');
	return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="${e(b.title)}">${grid}<polyline points="${path}" fill="none" stroke="${color}" stroke-width="2"/>${labels}</svg>`;
};

const heatmapSvg = (b: Extract<Block, { kind: 'heatmap' }>): string => {
	const cell = 40;
	const size = cell * b.size;
	const cells = b.cells
		.map(
			(c) =>
				`<rect x="${c.col * cell + 1}" y="${c.row * cell + 1}" width="${cell - 2}" height="${cell - 2}" rx="3" fill="${BUCKET_COLORS[c.bucket]}"/><text x="${c.col * cell + cell / 2}" y="${c.row * cell + cell / 2}" font-size="12" font-weight="bold" fill="#fff" text-anchor="middle" dominant-baseline="central">${e(c.text)}</text>`,
		)
		.join('');
	return `<svg viewBox="0 0 ${size} ${size}" width="${Math.min(size, 320)}" role="img" aria-label="${e(b.title)}">${cells}</svg>`;
};

const legend = (): string =>
	`<div class="legend">${Object.entries(BUCKET_LABELS)
		.map(([k, label]) => `<span><i style="background:${BUCKET_COLORS[k as keyof typeof BUCKET_COLORS]}"></i>${e(label)}</span>`)
		.join('')}</div>`;

export const blocksHtml = (blocks: Block[], primary: string): string =>
	blocks
		.map((b) => {
			switch (b.kind) {
				case 'heading':
					return b.level === 1 ? `<h2 class="part">${e(b.text)}</h2>` : `<h3>${e(b.text)}</h3>`;
				case 'paragraph':
					return `<p${b.muted ? ' class="muted"' : ''}>${e(b.text)}</p>`;
				case 'kpis':
					return `<div class="kpis">${b.items
						.map(
							(i) =>
								`<div class="kpi"><div class="kl">${e(i.label)}</div><div class="kv">${e(i.value)}</div>${i.sub ? `<div class="ks" style="color:${TONE_COLORS[i.tone ?? 'neutral']}">${e(i.sub)}</div>` : ''}</div>`,
						)
						.join('')}</div>`;
				case 'table':
					return `<div class="tw"><table><thead><tr>${b.columns.map((c) => `<th class="${c.align === 'right' ? 'r' : ''}">${e(c.label)}</th>`).join('')}</tr></thead><tbody>${b.rows
						.map(
							(row, r) =>
								`<tr${b.highlight?.includes(r) ? ' class="hl"' : ''}>${row.map((cell, i) => `<td class="${b.columns[i]?.align === 'right' ? 'r' : ''}">${e(cell)}</td>`).join('')}</tr>`,
						)
						.join('')}</tbody></table></div>`;
				case 'line_chart':
					return `<figure><figcaption>${e(b.title)}</figcaption>${lineChartSvg(b, primary)}</figure>`;
				case 'heatmap':
					return `<figure><figcaption>${e(b.title)}</figcaption>${heatmapSvg(b)}${legend()}</figure>`;
				case 'list':
					return `<ul>${b.items.map((i) => `<li>${e(i)}</li>`).join('')}</ul>`;
				case 'unavailable':
					return `<div class="na">${e(b.message)}</div>`;
				case 'quotes':
					return b.items
						.map(
							(q) =>
								`<blockquote><p>${e(q.text)}</p><cite>${q.link ? `<a href="${e(q.link)}" rel="nofollow noopener noreferrer" target="_blank">${e(q.meta)}</a>` : e(q.meta)}</cite></blockquote>`,
						)
						.join('');
				case 'page_break':
					return '<hr>';
				default:
					return '';
			}
		})
		.join('\n');

const css = (primary: string, secondary: string) => `
*{box-sizing:border-box}body{margin:0;background:#f3f4f6;color:${TEXT};font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
header{background:${primary};color:#fff;padding:20px 16px}header .in{max-width:900px;margin:0 auto;display:flex;align-items:center;gap:16px}
header img{max-height:56px;max-width:160px}header .bn{font-size:20px;font-weight:700}header .ct{font-size:13px;opacity:.9}
main{max-width:900px;margin:0 auto;padding:16px}section.card{background:#fff;border-radius:8px;padding:20px 16px;margin-bottom:16px}
h1{margin:0 0 4px;font-size:24px}.loc{color:${secondary};font-weight:700;font-size:17px}.muted,.meta{color:${MUTED};font-size:13px}
h2.part{color:${primary};margin:24px 0 8px}h3{margin:20px 0 8px;font-size:16px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:8px 0}.kpi{background:#f3f4f6;border-radius:6px;padding:10px}
.kl{font-size:12px;color:${MUTED}}.kv{font-size:22px;font-weight:700}.ks{font-size:12px}
.tw{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13px;margin:8px 0}th{background:${primary};color:#fff;text-align:left;padding:6px}
td{padding:6px;border-bottom:1px solid #e5e7eb}.r{text-align:right}tr.hl td{background:#fef3c7}
figure{margin:12px 0}figcaption{font-weight:700;font-size:13px;margin-bottom:6px}.legend{font-size:12px;color:${MUTED};display:flex;flex-wrap:wrap;gap:10px;margin-top:6px}
blockquote{margin:10px 0;padding:4px 12px;border-left:3px solid ${secondary}}blockquote p{margin:0 0 4px}cite{color:${MUTED};font-size:12px;font-style:normal}cite a{color:${MUTED}}
.legend i{display:inline-block;width:10px;height:10px;margin-right:4px;vertical-align:middle}.na{background:#f3f4f6;color:${MUTED};padding:12px;border-radius:6px}
hr{border:0;border-top:1px solid #e5e7eb;margin:24px 0}.dl{display:inline-block;margin-top:12px;background:${secondary};color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none}
footer{max-width:900px;margin:0 auto;padding:8px 16px 32px;color:${MUTED};font-size:12px}`;

const logoImg = (doc: ReportDocument): string =>
	doc.branding.logo ? `<img src="data:${doc.branding.logo.mime};base64,${doc.branding.logo.data_base64}" alt="${e(doc.branding.name)}">` : '';

const metaLines = (doc: ReportDocument): string[] => {
	const l = doc.location;
	return [
		[l.address, l.city, l.state, l.country].filter(Boolean).join(', '),
		l.client_name ? `Client: ${l.client_name}` : '',
		doc.period ?? '',
		`Generated ${DateTime.fromJSDate(doc.generated_at, { zone: 'utc' }).toFormat('d LLL yyyy')}`,
	].filter(Boolean);
};

/** The public share page. `pdfHref` is the relative download link. */
export const renderSharePage = (doc: ReportDocument, pdfHref: string): string => {
	const b = doc.branding;
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${e(doc.title)}: ${e(doc.location.name)}</title><style>${css(b.primary_color, b.secondary_color)}</style></head>
<body><header><div class="in">${logoImg(doc)}<div><div class="bn">${e(b.name)}</div>${b.contact_text ? `<div class="ct">${e(b.contact_text)}</div>` : ''}</div></div></header>
<main><section class="card"><h1>${e(doc.title)}</h1><div class="loc">${e(doc.location.name)}</div>${metaLines(doc)
		.map((m) => `<div class="meta">${e(m)}</div>`)
		.join('')}<a class="dl" href="${e(pdfHref)}">Download PDF</a></section>
<section class="card">${blocksHtml(doc.blocks, b.primary_color)}</section></main>
<footer>${doc.attribution ? `${e(doc.attribution)}<br>` : ''}${b.footer_text ? `${e(b.footer_text)}<br>` : ''}${b.hide_mypageseo ? '' : 'Powered by MyPageSEO'}</footer></body></html>`;
};

/** The body of a report email: header, title, the first headline numbers and the delivery note. */
export const renderEmailHtml = (doc: ReportDocument, note: { message: string | null; link: string | null }): string => {
	const b = doc.branding;
	const firstKpis = doc.blocks.find((x) => x.kind === 'kpis');
	const kpis =
		firstKpis && firstKpis.kind === 'kpis'
			? `<table role="presentation" cellpadding="8" style="border-collapse:collapse"><tr>${firstKpis.items
					.map((i) => `<td style="background:#f3f4f6"><div style="font-size:12px;color:${MUTED}">${e(i.label)}</div><div style="font-size:20px;font-weight:700">${e(i.value)}</div></td>`)
					.join('')}</tr></table>`
			: '';
	return `<div style="font-family:Arial,Helvetica,sans-serif;color:${TEXT};max-width:600px">
<div style="background:${b.primary_color};color:#fff;padding:16px;font-size:18px;font-weight:700">${e(b.name)}</div>
<div style="padding:16px"><h2 style="margin:0 0 4px">${e(doc.title)}</h2><div style="color:${b.secondary_color};font-weight:700">${e(doc.location.name)}</div>
${doc.period ? `<div style="color:${MUTED};font-size:13px">${e(doc.period)}</div>` : ''}
${note.message ? `<p>${e(note.message).replace(/\n/g, '<br>')}</p>` : ''}${kpis}
<p>${note.link ? `The report is available here (the link expires in 30 days): <a href="${e(note.link)}">view the report</a>.` : 'The full report is attached as a PDF.'}</p>
<p style="color:${MUTED};font-size:12px">${b.footer_text ? `${e(b.footer_text)}<br>` : ''}${b.contact_text ? `${e(b.contact_text)}<br>` : ''}${b.hide_mypageseo ? '' : 'Powered by MyPageSEO'}</p></div></div>`;
};

export const renderEmailText = (doc: ReportDocument, note: { message: string | null; link: string | null }): string =>
	[
		`${doc.title}: ${doc.location.name}`,
		doc.period ?? '',
		note.message ?? '',
		note.link ? `View the report (the link expires in 30 days): ${note.link}` : 'The full report is attached as a PDF.',
		doc.branding.footer_text ?? '',
		doc.branding.hide_mypageseo ? '' : 'Powered by MyPageSEO',
	]
		.filter(Boolean)
		.join('\n\n');
