import { GOOGLE_ATTRIBUTION } from '../../constants/attribution';
import { ISalesAudit } from '../../models/salesAudit.model';
import { AUDIT, AuditCell, AuditSummary, CheckItem, PublicFacts, QuickScore, auditBucket, auditRankText } from '../../salesAudit/compute';
import { DEFAULT_BRANDING } from '../reports/branding.service';
import { Block, ReportDocument } from '../reports/types';

// Sales audit (Phase 19): the one-PDF document (both parts), drawn by the Reports center PDF renderer.
// Part 1: ranking for the keyword (KPIs, the 7×7 heatmap, who ranks higher). Part 2: the quick GBP score
// from public data, compared with the top 3 others, and what to work on. MyPageSEO branding.

interface StoredBusiness extends PublicFacts {
	country: string;
	score: QuickScore;
	checklist: CheckItem[];
}

interface StoredCompetitor {
	rank: number;
	name: string | null;
	address: string | null;
	facts: PublicFacts | null;
	score: QuickScore | null;
}

interface StoredResult {
	cells: AuditCell[];
	summary: AuditSummary;
	higher: { rank: number; name: string | null; address: string | null; is_self: boolean }[] | null;
	competitors: StoredCompetitor[];
}

const pct = (v: number | null): string => (v === null ? '-' : `${Math.round(v * 100)}%`);
const num = (v: number | null | undefined, d = 0): string => (v === null || v === undefined ? '-' : v.toFixed(d));
const yesNo = (v: boolean): string => (v ? 'Yes' : 'No');
const photos = (n: number | null): string => (n === null ? '-' : n >= 10 ? '10+' : String(n));
const STATE_TEXT: Record<CheckItem['state'], string> = { good: 'Good', partial: 'Could be better', missing: 'Missing' };

/** Plain-language actions from the checklist and the gap to the top 3 (at most 5). */
export const actionsFor = (b: StoredBusiness, competitors: StoredCompetitor[]): string[] => {
	const out: string[] = [];
	const best = Math.max(0, ...competitors.map((c) => c.facts?.user_rating_count ?? 0));
	const mine = b.user_rating_count ?? 0;
	if (best > mine) out.push(`Get more Google reviews: you have ${mine}, the leading business near you has ${best}.`);
	const item = (id: CheckItem['id']) => b.checklist.find((c) => c.id === id);
	if (item('rating')?.state !== 'good' && b.rating !== null) out.push(`Lift your rating (${b.rating.toFixed(1)} stars) by asking happy customers for reviews and replying to every review.`);
	if (item('hours')?.state === 'missing') out.push('Add your opening hours to your Google Business Profile.');
	if (item('website')?.state === 'missing') out.push('Add your website to your Google Business Profile.');
	if (item('phone')?.state === 'missing') out.push('Add a phone number to your Google Business Profile.');
	if (item('photos')?.state !== 'good') out.push('Upload more photos of your business, team and work.');
	if (item('primary_category')?.state === 'missing') out.push('Set the right primary category for your business.');
	return out.slice(0, 5);
};

export const auditDocument = (audit: Pick<ISalesAudit, 'keyword' | 'business' | 'grid' | 'result'>, generatedAt: Date): ReportDocument => {
	const b = audit.business as unknown as StoredBusiness;
	const r = audit.result as unknown as StoredResult;
	const s = r.summary;
	const blocks: Block[] = [];

	// ---- Part 1: ranking ----
	blocks.push({ kind: 'heading', level: 1, text: `Google Maps ranking for “${audit.keyword}”` });
	blocks.push({
		kind: 'paragraph',
		text: `We searched “${audit.keyword}” from ${s.points} points on a ${audit.grid.size}×${audit.grid.size} grid within ${audit.grid.radius_km} km of the business, the way Google Maps shows results to people nearby. Ranks are shown to ${AUDIT.maxRank}; deeper is ${AUDIT.maxRank}+.`,
		muted: true,
	});
	blocks.push({
		kind: 'kpis',
		items: [
			{ label: 'Rank at your business', value: s.center_status === 'error' ? '-' : s.center_rank === null ? `${AUDIT.maxRank}+` : `#${s.center_rank}`, tone: s.center_rank !== null && s.center_rank <= 3 ? 'good' : 'bad' },
			{ label: 'Average rank in the area', value: num(s.avg_rank, 1), sub: `${AUDIT.maxRank}+ counted as ${AUDIT.maxRank + 1}` },
			{ label: `In the top ${AUDIT.maxRank}`, value: pct(s.found_rate), sub: 'of the area' },
			{ label: 'In the top 3', value: pct(s.top3_rate), sub: 'of the area', tone: (s.top3_rate ?? 0) >= 0.5 ? 'good' : 'bad' },
		],
	});
	blocks.push({
		kind: 'heatmap',
		title: `Where you rank within ${audit.grid.radius_km} km (your business is the center square)`,
		size: audit.grid.size,
		cells: r.cells.map((c) => ({ row: c.row, col: c.col, text: auditRankText(c), bucket: auditBucket(c) })),
		max_rank: AUDIT.maxRank,
	});
	blocks.push({ kind: 'heading', level: 2, text: 'Who ranks higher at your business' });
	if (!r.higher) {
		blocks.push({ kind: 'unavailable', title: 'Who ranks higher', message: 'The list of businesses could not be loaded for this audit.' });
	} else if (s.center_rank === 1) {
		blocks.push({ kind: 'paragraph', text: `You are #1 for “${audit.keyword}” at your business.` });
	} else {
		const rows = r.higher.map((h) => [String(h.rank), h.name ?? '-', h.address ?? '-']);
		if (s.center_rank !== null) rows.push([String(s.center_rank), `${b.name ?? 'Your business'} (you)`, b.address ?? '-']);
		blocks.push({
			kind: 'paragraph',
			text:
				s.center_rank === null
					? `You are not in the top ${AUDIT.maxRank} at your business: these ${r.higher.length} businesses all show up first.`
					: `${r.higher.length} ${r.higher.length === 1 ? 'business shows' : 'businesses show'} up before you.`,
			muted: true,
		});
		blocks.push({
			kind: 'table',
			columns: [{ label: 'Rank', align: 'right' }, { label: 'Business', weight: 3 }, { label: 'Address', weight: 4 }],
			rows,
			highlight: s.center_rank !== null ? [rows.length - 1] : [],
		});
	}

	// ---- Part 2: quick GBP score (follows on the same page when there's room) ----
	blocks.push({ kind: 'heading', level: 1, text: 'Google Business Profile: quick score' });
	blocks.push({
		kind: 'paragraph',
		text: 'From the public information Google shows about the business only. A full audit with the profile connected also covers performance, posts, photos, reviews and replies.',
		muted: true,
	});
	blocks.push({
		kind: 'kpis',
		items: [
			{ label: 'Quick score', value: `${b.score.score}/100`, sub: `Grade ${b.score.grade}${b.score.flag ? `, ${b.score.flag.replace(/_/g, ' ')}` : ''}`, tone: b.score.score >= 70 ? 'good' : 'bad' },
			{ label: 'Rating', value: num(b.rating, 1) },
			{ label: 'Reviews', value: num(b.user_rating_count) },
			{ label: 'Photos', value: photos(b.photo_count) },
		],
	});
	blocks.push({
		kind: 'table',
		columns: [{ label: 'Check', weight: 2 }, { label: 'Status', weight: 2 }, { label: 'Found', weight: 3 }],
		rows: b.checklist.map((c) => [c.label, STATE_TEXT[c.state], c.detail]),
	});
	blocks.push({ kind: 'heading', level: 2, text: 'How you compare with the top 3' });
	const rows: { name: string; rank: string; f: PublicFacts | null; score: QuickScore | null; self: boolean }[] = [
		{ name: `${b.name ?? 'Your business'} (you)`, rank: s.center_rank === null ? `${AUDIT.maxRank}+` : String(s.center_rank), f: b, score: b.score, self: true },
		...r.competitors.map((c) => ({ name: c.name ?? '-', rank: String(c.rank), f: c.facts, score: c.score, self: false })),
	];
	blocks.push({
		kind: 'table',
		columns: [
			{ label: 'Business', weight: 3 },
			{ label: 'Rank', align: 'right' },
			{ label: 'Score', align: 'right' },
			{ label: 'Rating', align: 'right' },
			{ label: 'Reviews', align: 'right' },
			{ label: 'Photos', align: 'right' },
			{ label: 'Hours' },
			{ label: 'Website' },
		],
		rows: rows.map((x) => [
			x.name,
			x.rank,
			x.score ? `${x.score.score}` : '-',
			num(x.f?.rating, 1),
			num(x.f?.user_rating_count),
			photos(x.f?.photo_count ?? null),
			x.f ? yesNo(x.f.has_hours) : '-',
			x.f ? yesNo(Boolean(x.f.website)) : '-',
		]),
		highlight: [0],
	});
	const actions = actionsFor(b, r.competitors);
	blocks.push({ kind: 'heading', level: 2, text: 'What to work on first' });
	blocks.push(actions.length ? { kind: 'list', items: actions } : { kind: 'paragraph', text: 'The public profile looks complete. Rankings are the next step.', muted: true });
	blocks.push({ kind: 'paragraph', text: GOOGLE_ATTRIBUTION.text, muted: true });

	return {
		title: 'Local visibility audit',
		type: 'sales_audit',
		// The formatted address already ends with the country.
		location: { name: b.name ?? 'Business', address: b.address ?? null, city: null, state: null, country: null, client_name: null },
		generated_at: generatedAt,
		period: `Keyword: ${audit.keyword}`,
		branding: { name: DEFAULT_BRANDING.name, primary_color: DEFAULT_BRANDING.primary_color, secondary_color: DEFAULT_BRANDING.secondary_color, footer_text: 'MyPageSEO · mypageseo.com', contact_text: null, hide_mypageseo: true, logo: null },
		blocks,
		attribution: GOOGLE_ATTRIBUTION.text,
	};
};
