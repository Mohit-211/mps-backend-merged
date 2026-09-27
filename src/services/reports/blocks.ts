import { DateTime } from 'luxon';
import { FrozenBranding, ReportType, SnapshotLocation } from '../../models';
import { bucket, displayRank } from '../../ranking/rankCell';
import { Block, CompetitorData, GbpAuditData, Part, RankTrackerData, ReportDocument, SnapshotData, Tone, isAvailable } from './types';

// Reports center (Phase 12): turns frozen snapshot data into the document model (typed blocks). Pure.
// The PDF renderer, the HTML share page, the in-app viewer (GET /reports/:id) and the email summary
// all read the same blocks, so they always show the same numbers.

export const TYPE_TITLES: Record<ReportType, string> = {
	rank_tracker: 'Rank Tracker Report',
	gbp_audit: 'Google Business Profile Audit',
	competitor_analysis: 'Competitor Analysis',
	full: 'Local SEO Report',
};

const UNAVAILABLE_TEXT: Record<string, string> = {
	gbp_not_connected: 'The Google Business Profile is not connected for this location.',
	v4_access_pending: 'Not available yet: this needs Google My Business v4 access.',
	not_synced_yet: 'No Google Business Profile data has been synced yet.',
	no_data: 'No data for this period.',
	no_rank_run: 'No completed rank run yet.',
	no_gbp_report: 'The GBP report has not been generated yet.',
	no_place_id: 'This location has no Google place.',
	places_not_configured: 'Competitor data could not be fetched.',
};

export const unavailableText = (reason: string): string => UNAVAILABLE_TEXT[reason] ?? 'Not available.';

// ---- formatting ----

export const fmtDate = (d: Date | string | null | undefined): string => (d ? DateTime.fromJSDate(new Date(d), { zone: 'utc' }).toFormat('d LLL yyyy') : '-');
const fmtNum = (v: number | null | undefined, decimals = 0): string =>
	v === null || v === undefined ? '-' : v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const fmtPct = (v: number | null | undefined): string => (v === null || v === undefined ? '-' : `${Math.round(v * 100)}%`);
/** Rank change: positive = improved. */
const fmtRankChange = (v: number | null | undefined): string => (v === null || v === undefined ? '-' : v > 0 ? `▲ ${fmtNum(v, 1)}` : v < 0 ? `▼ ${fmtNum(-v, 1)}` : '0');
const fmtRelChange = (v: number | null | undefined): string => (v === null || v === undefined ? '-' : `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`);
const toneOf = (v: number | null | undefined): Tone => (v === null || v === undefined || v === 0 ? 'neutral' : v > 0 ? 'good' : 'bad');
const yesNo = (v: boolean | null | undefined): string => (v === null || v === undefined ? '-' : v ? 'Yes' : 'No');
const avgRank = (v: number | null | undefined): string => (v === null || v === undefined ? '-' : v > 60 ? '60+' : fmtNum(v, 1));

const LABELS: Record<string, string> = {
	improved: 'Improved',
	declined: 'Declined',
	unchanged: 'Unchanged',
	entered_top_60: 'Entered top 60',
	dropped_out_of_top_60: 'Dropped out of top 60',
};

const unavailable = (title: string, part: { reason: string }): Block => ({ kind: 'unavailable', title, message: unavailableText(part.reason) });

// ---- Rank Tracker ----

export const rankTrackerBlocks = (d: RankTrackerData): Block[] => {
	const out: Block[] = [];
	if (d.run.partial) out.push({ kind: 'paragraph', text: 'Some searches in this run failed; those points are excluded from the averages.', muted: true });
	if (d.summary) {
		out.push({ kind: 'heading', level: 2, text: 'Summary' });
		out.push({
			kind: 'kpis',
			items: [
				{ label: 'Average rank', value: avgRank(d.summary.overall_avg_rank), sub: d.summary.change === null ? null : `${fmtRankChange(d.summary.change)} vs previous run`, tone: toneOf(d.summary.change) },
				{ label: 'Top-3 rate', value: fmtPct(d.summary.top3_rate) },
				{ label: 'Found in top 60', value: fmtPct(d.summary.found_rate) },
				{ label: 'Keywords', value: fmtNum(d.summary.keywords) },
			],
		});
	}
	if (d.keywords) {
		out.push({ kind: 'heading', level: 2, text: 'Keywords' });
		out.push({
			kind: 'table',
			columns: [{ label: 'Keyword', weight: 3 }, { label: 'Avg rank', align: 'right' }, { label: 'Top-3', align: 'right' }, { label: 'Found', align: 'right' }, { label: 'Change', align: 'right', weight: 1.6 }],
			rows: d.keywords.map((k) => [
				k.keyword,
				avgRank(k.avg_rank),
				fmtPct(k.top3_rate),
				fmtPct(k.found_rate),
				k.label === 'entered_top_60' || k.label === 'dropped_out_of_top_60' ? LABELS[k.label] : fmtRankChange(k.change),
			]),
		});
	}
	if (d.history && d.history.length > 1) {
		out.push({ kind: 'heading', level: 2, text: 'Average rank over time' });
		out.push({ kind: 'line_chart', title: 'Average rank (lower is better)', points: d.history.map((h) => ({ label: fmtDate(h.run_at), value: h.overall_avg_rank })), lower_is_better: true });
	}
	if (d.movers) {
		const m = d.movers;
		const items = [
			...m.improved.map((k) => `${k.keyword}: improved by ${fmtNum(k.change, 1)}`),
			...m.entered.map((k) => `${k}: entered the top 60`),
			...m.declined.map((k) => `${k}: declined by ${fmtNum(-k.change, 1)}`),
			...m.dropped.map((k) => `${k}: dropped out of the top 60`),
		];
		out.push({ kind: 'heading', level: 2, text: 'Biggest movers' });
		out.push(items.length ? { kind: 'list', items } : { kind: 'paragraph', text: 'No comparable movement since the previous run.', muted: true });
	}
	if (d.grid && d.grid.length) {
		out.push({ kind: 'page_break' });
		out.push({ kind: 'heading', level: 2, text: `Local search grid (${d.run.grid_size}×${d.run.grid_size}, ${fmtNum(d.run.spacing_km, 2)} km apart)` });
		for (const g of d.grid) {
			out.push({
				kind: 'heatmap',
				title: `${g.keyword}: average ${avgRank(g.avg_rank)}, top-3 ${fmtPct(g.top3_rate)}`,
				size: g.size,
				cells: g.cells.map((c) => ({ row: c.row, col: c.col, text: displayRank({ rank: c.rank, status: c.status }).replace('error', '!'), bucket: bucket({ rank: c.rank, status: c.status }) })),
			});
		}
	}
	return out;
};

// ---- GBP Audit ----

const partBlocks = <T extends object>(title: string, part: Part<T> | undefined, body: (p: T) => Block[]): Block[] => {
	if (!part) return [];
	if (!isAvailable(part)) return [{ kind: 'heading', level: 2, text: title }, unavailable(title, part as { reason: string })];
	return [{ kind: 'heading', level: 2, text: title }, ...body(part)];
};

export const gbpAuditBlocks = (d: GbpAuditData): Block[] => {
	const out: Block[] = [];
	out.push(
		...partBlocks('GBP Score', d.score, (s) => [
			{
				kind: 'kpis',
				items: [
					{ label: 'GBP Score', value: `${fmtNum(s.score)}/100`, sub: `Grade ${s.grade}` },
					...s.pillars.filter((p) => p.available).map((p) => ({ label: p.id.charAt(0).toUpperCase() + p.id.slice(1), value: `${fmtNum(p.score, 1)}/${p.weight}` })),
				],
			},
			...(s.partial ? [{ kind: 'paragraph' as const, text: `Partial score: ${s.excluded_pillars.join(', ')} not available yet, so the other pillars are rescaled to 100.`, muted: true }] : []),
		]),
	);
	out.push(
		...partBlocks('Profile checks', d.checks, (c) => [
			...(c.top_fixes.length ? [{ kind: 'heading' as const, level: 2 as const, text: 'Top fixes' }, { kind: 'list' as const, items: c.top_fixes.map((f) => (f.fix_hint ? `${f.label}: ${f.fix_hint}` : f.label)) }] : []),
			{
				kind: 'table',
				columns: [{ label: 'Check', weight: 3 }, { label: 'Pillar', weight: 1.2 }, { label: 'Points', align: 'right' }, { label: 'Detail', weight: 4 }],
				rows: c.checks.map((x) => [x.label, x.pillar, x.status === 'scored' ? `${fmtNum(x.points, 1)}/${x.max}` : 'n/a', x.status === 'scored' ? x.detail : 'Not available yet']),
			},
		]),
	);
	out.push(
		...partBlocks('Performance', d.performance, (p) => [
			{ kind: 'paragraph', text: `${fmtDate(p.start)} to ${fmtDate(p.end)} (${p.days} days).`, muted: true },
			{
				kind: 'kpis',
				items: [
					{ label: 'Impressions', value: fmtNum(p.totals.impressions), sub: `${fmtRelChange(p.previous_change.impressions)} vs previous period`, tone: toneOf(p.previous_change.impressions) },
					{ label: 'Actions', value: fmtNum(p.totals.actions), sub: `${fmtRelChange(p.previous_change.actions)} vs previous period`, tone: toneOf(p.previous_change.actions) },
					{ label: 'Actions per 1,000', value: fmtNum(p.actions_per_1000, 1), sub: p.actions_per_1000_change === null ? null : `${fmtRelChange(p.actions_per_1000_change)} vs previous`, tone: toneOf(p.actions_per_1000_change) },
				],
			},
			{
				kind: 'table',
				columns: [{ label: 'Metric', weight: 2 }, { label: 'Total', align: 'right' }, { label: 'vs last year', align: 'right' }],
				rows: [
					['Impressions on Maps', fmtNum(p.totals.maps), ''],
					['Impressions on Search', fmtNum(p.totals.search), ''],
					['Mobile / desktop', `${fmtNum(p.totals.mobile)} / ${fmtNum(p.totals.desktop)}`, ''],
					['Calls', fmtNum(p.totals.calls), ''],
					['Website clicks', fmtNum(p.totals.website_clicks), ''],
					['Direction requests', fmtNum(p.totals.direction_requests), ''],
					['All impressions', fmtNum(p.totals.impressions), fmtRelChange(p.last_year_change.impressions)],
					['All actions', fmtNum(p.totals.actions), fmtRelChange(p.last_year_change.actions)],
				],
			},
			...(p.by_day.length > 1
				? [{ kind: 'line_chart' as const, title: 'Impressions per day', points: p.by_day.map((x) => ({ label: fmtDate(x.date), value: x.impressions })), lower_is_better: false }]
				: []),
		]),
	);
	out.push(
		...partBlocks('Search keywords', d.keywords, (k) => [
			{ kind: 'paragraph', text: `Searches that showed the profile in ${k.latest_month}.`, muted: true },
			{
				kind: 'table',
				columns: [{ label: 'Keyword', weight: 3 }, { label: 'Impressions', align: 'right' }, { label: 'Change', align: 'right' }, { label: 'Tracked', align: 'right' }],
				rows: k.top.map((t) => [t.keyword, t.value !== null ? fmtNum(t.value) : `< ${fmtNum(t.threshold)}`, t.change === null ? '-' : `${t.change > 0 ? '+' : ''}${fmtNum(t.change)}`, yesNo(t.tracked)]),
			},
		]),
	);
	out.push(
		...partBlocks('Profile', d.profile, (p) => [
			{
				kind: 'table',
				columns: [{ label: 'Field', weight: 1.5 }, { label: 'Value', weight: 4 }],
				rows: [
					['Name', p.title ?? '-'],
					['Primary category', p.primary_category ?? '-'],
					['Other categories', p.additional_categories.join(', ') || '-'],
					['Phone', p.phone ?? '-'],
					['Website', p.website ?? '-'],
					['Opening hours', p.hours_set ? 'Set' : 'Missing'],
					['Description', p.description_length ? `${p.description_length} characters` : 'Missing'],
				],
			},
			{ kind: 'heading', level: 2, text: 'Name, phone and website consistency' },
			{
				kind: 'table',
				columns: [{ label: 'Field' }, { label: 'In MyPageSEO', weight: 3 }, { label: 'On Google', weight: 3 }, { label: 'Match', align: 'right' }],
				rows: p.nap.map((n) => [n.field.charAt(0).toUpperCase() + n.field.slice(1), n.location ?? '-', n.profile ?? '-', n.match === null ? '-' : n.match ? 'Yes' : 'No']),
				highlight: p.nap.map((n, i) => (n.match === false ? i : -1)).filter((i) => i >= 0),
			},
		]),
	);
	out.push(
		...partBlocks('Verification', d.verification, (v) => [
			{ kind: 'paragraph', text: v.verified ? 'The profile is verified.' : `The profile is not verified${v.state ? ` (${v.state})` : ''}.` },
		]),
	);
	out.push(
		...partBlocks('Suggested edits from Google', d.pending_edits, (e) => [
			{ kind: 'paragraph', text: e.has_pending ? `Google has edits waiting for review: ${e.fields.join(', ') || 'some fields'}.` : 'No edits from Google are waiting for review.' },
		]),
	);
	if (d.reviews_media_posts) {
		const r = d.reviews_media_posts;
		out.push(...partBlocks('Reviews', r.reviews, (x) => [
			{
				kind: 'kpis',
				items: [
					{ label: 'Average rating', value: fmtNum(x.average_rating, 1) },
					{ label: 'Reviews', value: fmtNum(x.total), sub: `${fmtNum(x.new_90d)} in 90 days` },
					{ label: 'Reply rate (90 days)', value: fmtPct(x.reply_rate_90d) },
					{ label: 'Unreplied', value: fmtNum(x.unreplied) },
				],
			},
		]));
		out.push(...partBlocks('Photos', r.media, (x) => [
			{ kind: 'paragraph', text: `${fmtNum(x.owner_count)} owner photos, ${fmtNum(x.customer_count)} customer photos. Latest owner upload: ${fmtDate(x.latest_owner_upload)}.` },
		]));
		out.push(...partBlocks('Posts', r.posts, (x) => [
			{ kind: 'paragraph', text: `${fmtNum(x.last_30_days)} posts in the last 30 days, ${fmtNum(x.last_90_days)} in 90 days. Latest post: ${fmtDate(x.last_post_at)}.` },
		]));
	}
	return out;
};

// ---- Competitor Analysis ----

export const competitorBlocks = (d: CompetitorData): Block[] => {
	const out: Block[] = [];
	if (d.public_scores) {
		out.push({ kind: 'heading', level: 2, text: 'Public Score' });
		out.push({ kind: 'paragraph', text: 'The same score for every business, from public Google data and center ranks.', muted: true });
		out.push({
			kind: 'table',
			columns: [{ label: 'Business', weight: 4 }, { label: 'Public Score', align: 'right' }],
			rows: d.public_scores.map((r) => [r.name + (r.is_self ? ' (you)' : ''), r.score === null ? '-' : `${fmtNum(r.score)}/100${r.flag ? ` (${r.flag.replace(/_/g, ' ')})` : ''}`]),
			highlight: d.public_scores.map((r, i) => (r.is_self ? i : -1)).filter((i) => i >= 0),
		});
	}
	if (d.table) {
		out.push({ kind: 'heading', level: 2, text: 'Side by side' });
		out.push({
			kind: 'table',
			columns: [{ label: 'Business', weight: 3 }, { label: 'Rating', align: 'right' }, { label: 'Reviews', align: 'right' }, { label: 'Category', weight: 2 }, { label: 'Hours' }, { label: 'Website' }, { label: 'Phone' }],
			rows: d.table.map((r) => [r.name + (r.is_self ? ' (you)' : ''), fmtNum(r.rating, 1), fmtNum(r.reviews), r.category ?? '-', yesNo(r.has_hours), yesNo(r.has_website), yesNo(r.has_phone)]),
			highlight: d.table.map((r, i) => (r.is_self ? i : -1)).filter((i) => i >= 0),
		});
	}
	if (d.ranks) {
		out.push({ kind: 'heading', level: 2, text: 'Rankings' });
		out.push({
			kind: 'table',
			columns: [{ label: 'Business', weight: 3 }, { label: 'Avg rank', align: 'right' }, { label: 'Top-3', align: 'right' }, { label: 'Center rank', align: 'right' }, { label: 'Center top-3', align: 'right' }],
			rows: d.ranks.map((r) => [r.name + (r.is_self ? ' (you)' : ''), avgRank(r.overall_avg_rank), fmtPct(r.top3_rate), avgRank(r.center_avg), fmtPct(r.center_top3_rate)]),
			highlight: d.ranks.map((r, i) => (r.is_self ? i : -1)).filter((i) => i >= 0),
		});
		out.push({ kind: 'paragraph', text: 'Average rank covers your tracked competitors only; center rank comes from the top 20 at your location.', muted: true });
	}
	if (d.insights) {
		out.push({ kind: 'heading', level: 2, text: 'Insights' });
		out.push(d.insights.length ? { kind: 'list', items: d.insights } : { kind: 'paragraph', text: 'No gaps found against these competitors.', muted: true });
	}
	return out;
};

// ---- Document ----

const PART_TITLES = { rank_tracker: 'Rankings', gbp_audit: 'Google Business Profile', competitor_analysis: 'Competitors' } as const;

const partOf = (key: keyof SnapshotData, part: SnapshotData[keyof SnapshotData]): Block[] => {
	if (!part) return [];
	if (!isAvailable(part as Part<object>)) return [unavailable(PART_TITLES[key], part as { reason: string })];
	if (key === 'rank_tracker') return rankTrackerBlocks(part as RankTrackerData);
	if (key === 'gbp_audit') return gbpAuditBlocks(part as GbpAuditData);
	return competitorBlocks(part as CompetitorData);
};

const periodOf = (type: ReportType, data: SnapshotData): string | null => {
	const rt = data.rank_tracker && isAvailable(data.rank_tracker) ? data.rank_tracker : null;
	const gbp = data.gbp_audit && isAvailable(data.gbp_audit) ? data.gbp_audit : null;
	const range = gbp ? { '28d': 'Last 28 days', '90d': 'Last 90 days', '12m': 'Last 12 months' }[gbp.range] : null;
	if (type === 'rank_tracker' && rt) return `Rank run of ${fmtDate(rt.run.finished_at ?? rt.run.run_at)}`;
	if (type === 'gbp_audit') return range;
	if (type === 'full') return [rt ? `Rank run of ${fmtDate(rt.run.finished_at ?? rt.run.run_at)}` : null, range].filter(Boolean).join(' · ') || null;
	return null;
};

export const buildDocument = (input: { type: ReportType; location: SnapshotLocation; branding: FrozenBranding; data: SnapshotData; generated_at: Date }): ReportDocument => {
	const { type, data } = input;
	let blocks: Block[];
	if (type === 'full') {
		blocks = [];
		for (const key of ['rank_tracker', 'gbp_audit', 'competitor_analysis'] as const) {
			if (!data[key]) continue;
			if (blocks.length) blocks.push({ kind: 'page_break' });
			blocks.push({ kind: 'heading', level: 1, text: PART_TITLES[key] }, ...partOf(key, data[key]));
		}
	} else {
		blocks = partOf(type, data[type]);
	}
	return { title: TYPE_TITLES[type], type, location: input.location, generated_at: input.generated_at, period: periodOf(type, data), branding: input.branding, blocks };
};
