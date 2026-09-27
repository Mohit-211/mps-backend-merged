import fs from 'fs';
import os from 'os';
import path from 'path';
import { FrozenBranding, GbpReportData } from '../../../src/models';
import { redactUrl } from '../../../src/configs/morgan';
import { buildDocument, gbpAuditBlocks, rankTrackerBlocks } from '../../../src/services/reports/blocks';
import { decodeDataUrl, effectiveBranding, imageTypeOf } from '../../../src/services/reports/branding.service';
import { renderEmailHtml, renderSharePage } from '../../../src/services/reports/render/html';
import { renderPdf } from '../../../src/services/reports/render/pdf';
import { pdfFilename, resolveSections } from '../../../src/services/reports/report.service';
import { buildCompetitorData } from '../../../src/services/reports/sections/competitors';
import { buildGbpAuditData, napCheck } from '../../../src/services/reports/sections/gbpAudit';
import { RunForReport, buildRankTrackerData } from '../../../src/services/reports/sections/rankTracker';
import { createStorage } from '../../../src/services/reports/storage';
import { Block, GbpAuditData, RankTrackerData } from '../../../src/services/reports/types';

// Phase 12: the pure parts of the reports center.

const BRAND: FrozenBranding = { name: 'Acme Agency', primary_color: '#1d4ed8', secondary_color: '#0f766e', footer_text: 'Acme footer', contact_text: 'hello@acme.test', hide_mypageseo: true, logo: null };
const LOCATION = { name: 'Café Montréal Plombier', address: '1 Rue Principale', city: 'Montréal', state: 'QC', country: 'Canada', client_name: 'Maple Group' };
const ALL_RT = ['summary', 'keywords', 'history', 'grid', 'movers', 'map_ranking'];

const cell = (rank: number | null, status: 'ok' | 'not_found' | 'error' = rank === null ? 'not_found' : 'ok') => ({ rank, status });
const run = (): RunForReport =>
	({
		run_at: new Date('2026-09-01T03:00:00Z'),
		finished_at: new Date('2026-09-01T03:10:00Z'),
		status: 'partial',
		config: { grid_size: 3, spacing_km: 1, tracker_offset_km: 1.5, radius_m: 5000, store_place_names: true },
		tracker: [
			{ keyword: 'plumber', cells: [], summary: { self: { avgRank: 2.4, foundRate: 1, top3Rate: 0.8, change: 3, changeLabel: 'improved' } } },
			{ keyword: 'drain cleaning', cells: [], summary: { self: { avgRank: 14, foundRate: 0.6, top3Rate: 0, change: -4.5, changeLabel: 'declined' } } },
			{ keyword: 'water heater', cells: [], summary: { self: { avgRank: 61, foundRate: 0, top3Rate: 0, change: null, changeLabel: 'dropped_out_of_top_60' } } },
			{ keyword: 'boiler', cells: [], summary: { self: { avgRank: 30, foundRate: 0.2, top3Rate: 0, change: null, changeLabel: 'entered_top_60' } } },
		],
		grid: [
			{
				keyword: 'plumber',
				size: 3,
				spacing_km: 1,
				points: [cell(1), cell(2), cell(5), cell(12), cell(25), cell(null), cell(null, 'error'), cell(3), cell(4)].map((c, i) => ({ row: Math.floor(i / 3), col: i % 3, lat: 0, lng: 0, byTarget: { self: c } })),
				summary: { self: { avgRank: 14.1, foundRate: 0.88, top3Rate: 0.38 } },
			},
		],
		overall: { self: { overallAvgRank: 26.9, change: -0.5 } },
	}) as unknown as RunForReport;

describe('rank tracker data and blocks', () => {
	it('copies the self target, keeps only requested sections, orders movers', () => {
		const d = buildRankTrackerData(run(), [{ run_at: new Date('2026-09-01'), overall_avg_rank: 26.9 }, { run_at: new Date('2026-08-01'), overall_avg_rank: 26.4 }], ALL_RT);
		expect(d.summary).toEqual({ overall_avg_rank: 26.9, change: -0.5, top3_rate: 0.2, found_rate: 0.45, keywords: 4 });
		expect(d.history?.map((h) => h.overall_avg_rank)).toEqual([26.4, 26.9]); // oldest first
		expect(d.movers).toEqual({ improved: [{ keyword: 'plumber', change: 3 }], declined: [{ keyword: 'drain cleaning', change: -4.5 }], entered: ['boiler'], dropped: ['water heater'] });
		expect(d.grid?.[0].cells[5]).toEqual({ row: 1, col: 2, rank: null, status: 'not_found' });
		expect(d.run.partial).toBe(true);
		const only = buildRankTrackerData(run(), [], ['keywords']);
		expect(Object.keys(only).sort()).toEqual(['available', 'keywords', 'run']);
	});

	it('heatmap buckets and labels: 60+ for not found, ! for a failed search; the partial note', () => {
		const blocks = rankTrackerBlocks(buildRankTrackerData(run(), [], ALL_RT));
		const heat = blocks.find((b) => b.kind === 'heatmap') as Extract<Block, { kind: 'heatmap' }>;
		expect(heat.cells.map((c) => `${c.text}:${c.bucket}`)).toEqual(['1:pack', '2:pack', '5:visible', '12:low', '25:invisible', '60+:not_found', '!:error', '3:pack', '4:visible']);
		expect(blocks[0]).toMatchObject({ kind: 'paragraph', muted: true });
		const table = blocks.find((b) => b.kind === 'table') as Extract<Block, { kind: 'table' }>;
		expect(table.rows[2]).toEqual(['water heater', '60+', '0%', '0%', 'Dropped out of top 60']);
		expect(table.rows[0][4]).toBe('▲ 3.0');
	});
});

const gbpReport = (over: Partial<GbpReportData> = {}) =>
	({
		generated_at: new Date('2026-09-02'),
		v4_enabled: false,
		gbp_score: {
			available: true,
			score: 72,
			grade: 'B',
			partial: true,
			excluded_pillars: ['activity', 'reviews'],
			pillars: [{ id: 'completeness', weight: 25, available: true, earned: 20, available_max: 25, score: 20 }],
			checks: [{ id: 'website', pillar: 'completeness', label: 'Website set', status: 'scored', value: true, points: 4, max: 4, detail: 'Set', fix_hint: null }],
			top_fixes: [{ id: 'description', pillar: 'completeness', label: 'Add a description', status: 'scored', value: 0, points: 0, max: 4, detail: '', fix_hint: 'Write 250+ characters' }],
		},
		performance: { available: false, reason: 'not_synced_yet' },
		keywords: { available: true, months: ['2026-08'], latest_month: '2026-08', top: [{ keyword: 'plumber', value: null, threshold: 15, previous_value: null, change: null, tracked: true }], not_tracked: [] },
		reviews: { available: false, reason: 'v4_access_pending' },
		media: { available: false, reason: 'v4_access_pending' },
		posts: { available: false, reason: 'v4_access_pending' },
		pending_google_edits: { available: true, has_pending: true, diff_fields: ['title'], pending_fields: ['title', 'phone'] },
		verification: { available: true, has_voice_of_merchant: false, has_business_authority: false, state: 'UNVERIFIED' },
		...over,
	}) as unknown as GbpReportData;

const profile = { title: 'Cafe Montreal Plombier', primary_phone: '+1 416-555-0100', website: 'https://www.example.test/home', description: 'x'.repeat(120), primary_category: 'Plumber', additional_categories: [], regular_hours: [] } as never;

describe('GBP audit data and blocks', () => {
	it('NAP: accents, punctuation, +1 and www are normalised; a real mismatch is flagged', () => {
		expect(napCheck({ name: 'Café Montréal Plombier', mobile: '4165550100', website_URL: 'example.test' }, profile)).toEqual([
			{ field: 'name', location: 'Café Montréal Plombier', profile: 'Cafe Montreal Plombier', match: true },
			{ field: 'phone', location: '4165550100', profile: '+1 416-555-0100', match: true },
			{ field: 'website', location: 'example.test', profile: 'https://www.example.test/home', match: true },
		]);
		expect(napCheck({ name: 'Other', mobile: null, website_URL: null }, profile).map((r) => r.match)).toEqual([false, null, null]);
	});

	it('v4 sections are unavailable blocks, never numbers; thresholds print as "< N"', () => {
		const d = buildGbpAuditData(gbpReport(), profile, { name: 'Other name', mobile: null, website_URL: null }, '28d', ['score', 'keywords', 'performance', 'profile', 'pending_edits', 'verification', 'reviews_media_posts', 'checks']);
		expect(d.reviews_media_posts?.reviews).toEqual({ available: false, reason: 'v4_access_pending' });
		expect(d.performance).toEqual({ available: false, reason: 'not_synced_yet' });
		expect(d.pending_edits).toEqual({ has_pending: true, fields: ['title', 'phone'] });
		const blocks = gbpAuditBlocks(d);
		const na = blocks.filter((b) => b.kind === 'unavailable').map((b) => (b as { message: string }).message);
		expect(na).toEqual(expect.arrayContaining(['Not available yet: this needs Google My Business v4 access.', 'No Google Business Profile data has been synced yet.']));
		expect(na).toHaveLength(4); // performance + reviews + photos + posts
		const kw = blocks.filter((b) => b.kind === 'table')[1] as Extract<Block, { kind: 'table' }>;
		expect(kw.rows[0]).toEqual(['plumber', '< 15', '-', 'Yes']);
		const nap = blocks.filter((b) => b.kind === 'table').find((b) => (b as Extract<Block, { kind: 'table' }>).columns[1]?.label === 'In MyPageSEO') as Extract<Block, { kind: 'table' }>;
		expect(nap.highlight).toEqual([0]);
		expect(blocks.some((b) => b.kind === 'paragraph' && b.text.startsWith('Partial score'))).toBe(true);
	});
});

describe('competitor data', () => {
	it('names only (no place ids), public scores sorted, ranks joined by target key', () => {
		const row = (name: string, place_id: string, is_self: boolean, score: number) => ({
			name, place_id, is_self, source: is_self ? 'self' : 'tracking', rating: 4.5, user_rating_count: 10, primary_type: 'plumber', primary_type_label: 'Plumber',
			has_hours: true, has_website: !is_self, has_phone: true, has_editorial_summary: null, business_status: 'OPERATIONAL', fetched_at: new Date(), stale: false, error: null,
			center_rank: { avg: 3, top3_rate: 0.5, keywords_found: 1, keywords: 1 }, public_score: { score, parts: [], flag: null },
		});
		const d = buildCompetitorData(
			{ available: true, generated_at: new Date(), rows: [row('Me', 'P-self', true, 60), row('Rival', 'P-rival', false, 80)] as never, insights: [{ id: 'review_gap', impact: 1, message: 'Rival has more reviews', place_id: 'P-rival' }], warning: null },
			{ targets: [{ key: 'self', place_id: 'P-self' }, { key: 'competitor_1', place_id: 'P-rival' }], overall: { self: { overallAvgRank: 9, change: null }, competitor_1: { overallAvgRank: 4, change: null } }, tracker: [] } as never,
			['public_scores', 'table', 'ranks', 'insights'],
		);
		expect(d.public_scores?.map((r) => r.name)).toEqual(['Rival', 'Me']);
		expect(d.ranks?.map((r) => r.overall_avg_rank)).toEqual([9, 4]);
		expect(d.insights).toEqual(['Rival has more reviews']);
		expect(JSON.stringify(d)).not.toContain('P-rival');
	});
});

describe('sections and file names', () => {
	it('defaults to every section in canonical order; unknown sections are refused', () => {
		expect(resolveSections('rank_tracker')).toEqual(ALL_RT);
		expect(resolveSections('rank_tracker', ['movers', 'summary'])).toEqual(['summary', 'movers']);
		expect(resolveSections('full', ['gbp_audit'])).toEqual(['gbp_audit']);
		expect(() => resolveSections('gbp_audit', ['grid'])).toThrow('Unknown section');
		expect(pdfFilename('Café Montréal / Plumbing', 'gbp_audit', new Date('2026-09-02T12:00:00Z'))).toBe('cafe-montreal-plumbing-gbp-audit-2026-09-02.pdf');
	});
});

const fullDoc = (branding: FrozenBranding = BRAND, gbp: GbpAuditData | { available: false; reason: string } = { available: false, reason: 'gbp_not_connected' }) =>
	buildDocument({
		type: 'full',
		location: LOCATION,
		branding,
		generated_at: new Date('2026-09-02T00:00:00Z'),
		data: { rank_tracker: buildRankTrackerData(run(), [{ run_at: new Date('2026-08-01'), overall_avg_rank: 30 }, { run_at: new Date('2026-09-01'), overall_avg_rank: 26.9 }], ALL_RT) as RankTrackerData, gbp_audit: gbp },
	});

describe('PDF renderer', () => {
	it('renders a valid multi-page PDF with the branding; "Powered by" is hidden for white-label', async () => {
		const out = await renderPdf(fullDoc(), { collectText: true });
		expect(out.buffer.subarray(0, 5).toString()).toBe('%PDF-');
		expect(out.pages).toBeGreaterThan(1);
		expect(out.text).toEqual(expect.arrayContaining(['Acme Agency', 'Local SEO Report', 'Café Montréal Plombier', 'Rankings', 'The Google Business Profile is not connected for this location.']));
		expect(out.text).toContain(`Page 1 of ${out.pages}`);
		expect(out.text).not.toContain('Powered by MyPageSEO');
		const plain = await renderPdf(fullDoc({ ...BRAND, name: 'MyPageSEO', hide_mypageseo: false }), { collectText: true });
		expect(plain.text).toContain('Powered by MyPageSEO');
	});

	it('embeds a PNG logo and survives a broken one', async () => {
		const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
		const withLogo = await renderPdf(fullDoc({ ...BRAND, logo: { mime: 'image/png', data_base64: png.toString('base64') } }));
		const broken = await renderPdf(fullDoc({ ...BRAND, logo: { mime: 'image/png', data_base64: 'bm90IGFuIGltYWdl' } }));
		expect(withLogo.buffer.includes(Buffer.from('/Subtype /Image'))).toBe(true);
		expect(broken.pages).toBeGreaterThan(0);
	});
});

describe('HTML renderer', () => {
	it('share page: noindex, escaped, inline SVG, no scripts, no ids', () => {
		const html = renderSharePage(fullDoc({ ...BRAND, name: '<script>alert(1)</script>' }), 'https://api.test/r/tok/pdf');
		expect(html).toContain('<meta name="robots" content="noindex,nofollow">');
		expect(html).not.toMatch(/<script/i);
		expect(html).toContain('&lt;script&gt;');
		expect(html).toContain('<svg');
		expect(html).not.toMatch(/[a-f0-9]{24}/);
		expect(html).not.toContain('Powered by MyPageSEO');
	});

	it('email: link note when too large, attachment note otherwise', () => {
		expect(renderEmailHtml(fullDoc(), { message: 'Hi', link: 'https://x.test/r/abc' })).toContain('https://x.test/r/abc');
		expect(renderEmailHtml(fullDoc(), { message: null, link: null })).toContain('attached as a PDF');
	});
});

describe('storage', () => {
	it('atomic write/read/remove; paths are built from ids only', async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mps-storage-'));
		const s = createStorage(root);
		const file = s.pdfPath('0123456789abcdef01234567', 'abcdefabcdefabcdefabcdef');
		expect(file).toBe(path.join(root, 'pdf', '0123456789abcdef01234567', 'abcdefabcdefabcdefabcdef.pdf'));
		await s.write(file, Buffer.from('x'));
		expect((await s.read(file))?.toString()).toBe('x');
		expect(fs.readdirSync(path.dirname(file))).toEqual(['abcdefabcdefabcdefabcdef.pdf']); // no temp file left
		await s.remove(file);
		expect(await s.read(file)).toBeNull();
		expect(() => s.pdfPath('../../etc', 'abcdefabcdefabcdefabcdef')).toThrow('invalid id');
		await expect(s.write(path.join(root, '..', 'escape.pdf'), Buffer.from('x'))).rejects.toThrow('outside');
		fs.rmSync(root, { recursive: true, force: true });
	});
});

describe('branding helpers', () => {
	it('business organizations always get the default branding; agencies can hide MyPageSEO', () => {
		const custom = { agency_name: 'Acme', primary_color: '#000000', hide_mypageseo: true } as never;
		expect(effectiveBranding({ _id: 'x', name: 'Biz', type: 'business', branding: custom } as never)).toMatchObject({ name: 'MyPageSEO', primary_color: '#1d4ed8', hide_mypageseo: false, white_label: false });
		expect(effectiveBranding({ _id: 'x', name: 'Agency Org', type: 'agency', branding: custom } as never)).toMatchObject({ name: 'Acme', primary_color: '#000000', hide_mypageseo: true });
		expect(effectiveBranding({ _id: 'x', name: 'Agency Org', type: 'agency', branding: null } as never).name).toBe('Agency Org');
	});

	it('logo type by magic bytes, not by the declared type', () => {
		expect(imageTypeOf(decodeDataUrl('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='))).toEqual({ mime: 'image/png', ext: 'png' });
		expect(imageTypeOf(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toEqual({ mime: 'image/jpeg', ext: 'jpg' });
		expect(imageTypeOf(decodeDataUrl('data:image/png;base64,PHN2Zz48L3N2Zz4='))).toBeNull(); // an SVG labelled PNG
		expect(() => decodeDataUrl('not base64 !!')).toThrow('base64');
	});
});

describe('request log redaction', () => {
	it('never logs a share token', () => {
		expect(redactUrl('/r/AbC_123-xyz/pdf?x=1')).toBe('/r/[redacted]/pdf?x=1');
		expect(redactUrl('/api/v1/reports/abc')).toBe('/api/v1/reports/abc');
	});
});

describe('Phase 12.5 report content: Map Ranking across the area, reviews, Google attribution', () => {
	const withMaps = () =>
		({
			...run(),
			mapList: ['C', 'N', 'S', 'E', 'W'].map((point, p) => ({
				keyword: 'plumber',
				point,
				results: Array.from({ length: 20 }, (_, i) => ({ rank: i + 1, place_id: `P${i}`, name: i === p ? 'Café Montréal Plombier' : `Rival ${i}`, is_self: i === p, target_key: i === p ? 'self' : null })),
			})),
		}) as unknown as RunForReport;

	it('map_ranking: top 5 at each point in C N S E W order, with your rank; the table ends with a "You" row and the attribution follows', () => {
		const d = buildRankTrackerData(withMaps(), [], ['map_ranking']);
		expect(d.map_ranking?.[0].points.map((p) => `${p.point}:${p.self_rank}`)).toEqual(['C:1', 'N:2', 'S:3', 'E:4', 'W:5']);
		const blocks = rankTrackerBlocks(d);
		const table = blocks.find((b) => b.kind === 'table') as Extract<Block, { kind: 'table' }>;
		expect(table.columns.map((c) => c.label)).toEqual(['#', 'Center', 'North', 'South', 'East', 'West']);
		expect(table.rows[0][1]).toBe('Café Montréal Plombier (you)');
		expect(table.rows.at(-1)).toEqual(['You', '#1', '#2', '#3', '#4', '#5']);
		expect(blocks.at(-1)).toEqual({ kind: 'paragraph', text: 'Google Maps', muted: true });
	});

	it('competitor reviews become quotes with the author; photos show "10+"; the document carries the attribution to every page and the share page', async () => {
		const row = (name: string, isSelf: boolean, photos: number) => ({
			name, place_id: `id-${name}`, is_self: isSelf, source: isSelf ? 'self' : 'tracking', rating: 4.5, user_rating_count: 20, primary_type: 'plumber', primary_type_label: 'Plumber',
			has_hours: true, has_website: true, has_phone: true, has_editorial_summary: true, business_status: 'OPERATIONAL', fetched_at: new Date(), stale: false, error: null,
			center_rank: { avg: 3, top3_rate: 0.5, keywords_found: 1, keywords: 1 }, public_score: { score: 70, parts: [], flag: null },
			photo_count: photos, photos_capped: photos >= 10, recent_review_at: null,
			reviews: [1, 2, 3].map((n) => ({ rating: 5, text: `Review ${n} of ${name}`, publish_time: new Date(Date.UTC(2026, 8, 30 - n)), relative_time: `${n} days ago`, author: { name: `Author ${n}`, uri: `https://maps.test/a${n}` } })),
		});
		const data = buildCompetitorData({ available: true, generated_at: new Date(), rows: [row('Me', true, 4), row('Rival', false, 10)] as never, insights: [], warning: null }, null, ['table', 'reviews']);
		expect(data.table?.map((r) => r.photos)).toEqual([4, 10]);
		expect(data.reviews?.[1].items.map((i) => i.author)).toEqual(['Author 1', 'Author 2']); // newest 2
		const doc = buildDocument({ type: 'competitor_analysis', location: LOCATION, branding: BRAND, data: { competitor_analysis: data }, generated_at: new Date('2026-09-30T00:00:00Z') });
		expect(doc.attribution).toBe('Google Maps');
		const side = doc.blocks.find((b) => b.kind === 'table') as Extract<Block, { kind: 'table' }>;
		expect(side.rows.map((r) => r[3])).toEqual(['4', '10+']);
		const quotes = doc.blocks.find((b) => b.kind === 'quotes') as Extract<Block, { kind: 'quotes' }>;
		expect(quotes.items[0]).toEqual({ text: '★★★★★ “Review 1 of Me”', meta: 'Me (you): Author 1, 1 days ago (Google review)', link: 'https://maps.test/a1' });
		const pdf = await renderPdf(doc, { collectText: true });
		expect(pdf.text.filter((t) => t === 'Google Maps').length).toBeGreaterThanOrEqual(pdf.pages + 1); // every footer + under the tables
		expect(pdf.text).toContain('Me (you): Author 1, 1 days ago (Google review)');
		const html = renderSharePage(doc, 'https://api.test/r/t/pdf');
		expect(html).toContain('<a href="https://maps.test/a1" rel="nofollow noopener noreferrer" target="_blank">');
		expect(html.match(/Google Maps/g)?.length).toBeGreaterThanOrEqual(2);
		const rtOnly = buildDocument({ type: 'rank_tracker', location: LOCATION, branding: BRAND, data: { rank_tracker: buildRankTrackerData(run(), [], ['summary']) }, generated_at: new Date() });
		expect(rtOnly.attribution).toBeNull();
	});
});
