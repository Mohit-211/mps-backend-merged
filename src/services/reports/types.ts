import type { FrozenBranding, ReportRangeParam, ReportType, SnapshotLocation } from '../../models';
import type { RankBucket } from '../../ranking/types';

// Reports center (Phase 12): the frozen section data stored in a ReportSnapshot, and the document
// model (typed blocks) that both renderers (PDF and HTML) draw from. Snapshot data holds names and
// numbers only: no internal ids and no Google place ids.

export interface PartUnavailable {
	available: false;
	reason: string;
}

export type Part<T> = T | PartUnavailable;

export const isAvailable = <T extends object>(part: Part<T> | undefined): part is T => Boolean(part) && (part as { available?: boolean }).available !== false;

// ---- Rank Tracker ----

export interface RtKeywordRow {
	keyword: string;
	avg_rank: number | null;
	found_rate: number | null;
	top3_rate: number | null;
	change: number | null;
	label: string | null;
}

export interface RtGrid {
	keyword: string;
	size: number;
	spacing_km: number;
	cells: { row: number; col: number; rank: number | null; status: 'ok' | 'not_found' | 'error' }[];
	avg_rank: number | null;
	found_rate: number | null;
	top3_rate: number | null;
}

export interface RankTrackerData {
	available: true;
	run: { run_at: Date; finished_at: Date | null; partial: boolean; grid_size: number; spacing_km: number };
	summary?: { overall_avg_rank: number | null; change: number | null; top3_rate: number | null; found_rate: number | null; keywords: number };
	keywords?: RtKeywordRow[];
	history?: { run_at: Date; overall_avg_rank: number | null }[];
	grid?: RtGrid[];
	movers?: { improved: { keyword: string; change: number }[]; declined: { keyword: string; change: number }[]; entered: string[]; dropped: string[] };
	/** Phase 12.5: the named top 5 at each Map Ranking point, and the client's rank there (null = not in the top 20). */
	map_ranking?: { keyword: string; points: { point: string; top: { rank: number; name: string | null; is_self: boolean }[]; self_rank: number | null }[] }[];
}

// ---- GBP Audit ----

export interface GbpAuditData {
	available: true;
	generated_at: Date;
	range: ReportRangeParam;
	v4_enabled: boolean;
	score?: Part<{ score: number; grade: string; partial: boolean; excluded_pillars: string[]; pillars: { id: string; weight: number; score: number | null; available: boolean }[] }>;
	checks?: Part<{
		checks: { label: string; pillar: string; status: string; points: number; max: number; detail: string; fix_hint: string | null }[];
		top_fixes: { label: string; pillar: string; fix_hint: string | null }[];
	}>;
	performance?: Part<{
		start: string;
		end: string;
		days: number;
		totals: { impressions: number; maps: number; search: number; mobile: number; desktop: number; calls: number; website_clicks: number; direction_requests: number; actions: number };
		previous_change: { impressions: number | null; actions: number | null };
		last_year_change: { impressions: number | null; actions: number | null };
		actions_per_1000: number | null;
		actions_per_1000_change: number | null;
		by_day: { date: string; impressions: number; actions: number }[];
	}>;
	keywords?: Part<{ latest_month: string; top: { keyword: string; value: number | null; threshold: number | null; change: number | null; tracked: boolean }[] }>;
	profile?: Part<{
		title: string | null;
		primary_category: string | null;
		additional_categories: string[];
		phone: string | null;
		website: string | null;
		hours_set: boolean;
		description_length: number;
		nap: { field: 'name' | 'phone' | 'website'; location: string | null; profile: string | null; match: boolean | null }[];
	}>;
	verification?: Part<{ verified: boolean; state: string | null }>;
	pending_edits?: Part<{ has_pending: boolean; fields: string[] }>;
	reviews_media_posts?: {
		reviews: Part<{ average_rating: number | null; total: number; new_90d: number; reply_rate_90d: number | null; median_reply_hours: number | null; unreplied: number }>;
		media: Part<{ owner_count: number; customer_count: number; latest_owner_upload: Date | null }>;
		posts: Part<{ last_post_at: Date | null; last_30_days: number; last_90_days: number }>;
	};
}

// ---- Competitor Analysis ----

export interface CompetitorData {
	available: true;
	generated_at: Date;
	public_scores?: { name: string; is_self: boolean; score: number | null; flag: string | null }[];
	table?: {
		name: string;
		is_self: boolean;
		rating: number | null;
		reviews: number | null;
		category: string | null;
		has_hours: boolean;
		has_website: boolean;
		has_phone: boolean;
		status: string | null;
		/** Phase 12.5: photos Google returns (max 10 = "10+"); null before the data was fetched. */
		photos?: number | null;
		photos_capped?: boolean;
	}[];
	ranks?: { name: string; is_self: boolean; overall_avg_rank: number | null; top3_rate: number | null; center_avg: number | null; center_top3_rate: number | null }[];
	insights?: string[];
	/** Phase 12.5: up to 2 recent Google reviews per business, with the author attribution. */
	reviews?: { name: string; is_self: boolean; items: { rating: number | null; text: string | null; when: string | null; author: string | null; author_uri: string | null }[] }[];
}

export interface SnapshotData {
	rank_tracker?: Part<RankTrackerData>;
	gbp_audit?: Part<GbpAuditData>;
	competitor_analysis?: Part<CompetitorData>;
}

// ---- Document model ----

export type Tone = 'good' | 'bad' | 'neutral';

export type Block =
	| { kind: 'heading'; level: 1 | 2; text: string }
	| { kind: 'paragraph'; text: string; muted?: boolean }
	| { kind: 'kpis'; items: { label: string; value: string; sub?: string | null; tone?: Tone }[] }
	| { kind: 'table'; columns: { label: string; align?: 'left' | 'right'; weight?: number }[]; rows: string[][]; highlight?: number[] }
	| { kind: 'line_chart'; title: string; points: { label: string; value: number | null }[]; lower_is_better: boolean }
	| { kind: 'heatmap'; title: string; size: number; cells: { row: number; col: number; text: string; bucket: RankBucket }[] }
	| { kind: 'list'; items: string[] }
	| { kind: 'unavailable'; title: string; message: string }
	/** Quoted text with an attribution line (Google reviews: author name, linked in HTML). */
	| { kind: 'quotes'; items: { text: string; meta: string; link: string | null }[] }
	| { kind: 'page_break' };

export interface ReportDocument {
	title: string;
	type: ReportType;
	location: SnapshotLocation;
	generated_at: Date;
	/** e.g. "Rank run of 1 Sep 2026" or "Last 28 days". */
	period: string | null;
	branding: FrozenBranding;
	blocks: Block[];
	/** Phase 12.5: "Google Maps" (the attribution) when the document shows Places content (printed in the footer). */
	attribution: string | null;
}
