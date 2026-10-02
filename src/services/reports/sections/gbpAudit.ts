import { GbpProfileSummary, GbpReportData, ReportRangeParam } from '../../../models';
import { normaliseName, normalisePhone, normaliseWebsite } from '../../../utils/nap';
import { AuditPerformanceTotals, GbpAuditData, Part, PartUnavailable } from '../types';
import { CheckState, countStates } from '../../../gbp/score/gbpScore';

// GBP Audit report data (Phase 12): copied from the location's stored GBP report (7c) and its latest
// profile snapshot. Sections that need GBP v4 (reviews, media, posts) stay `unavailable` until that
// access exists: never sample data.

const KEYWORDS_TOP = 20;

type Section = 'score' | 'checks' | 'performance' | 'keywords' | 'profile' | 'verification' | 'pending_edits' | 'reviews_media_posts';

export type ReportForAudit = Pick<
	GbpReportData,
	'generated_at' | 'v4_enabled' | 'gbp_score' | 'performance' | 'keywords' | 'reviews' | 'media' | 'posts' | 'pending_google_edits' | 'verification'
>;

export interface LocationForNap {
	name: string | null;
	mobile: string | null;
	website_URL: string | null;
}

const off = (reason: string): PartUnavailable => ({ available: false, reason });

/** Reports generated before 2026-10-02 have no check state: derive it the same way. */
const stateOf = (c: { status: string; points: number; max: number }): CheckState =>
	c.status !== 'scored' ? 'not_available' : c.points >= c.max ? 'pass' : c.points <= 0 ? 'fail' : 'partial';

const TOTAL_KEYS: (keyof AuditPerformanceTotals)[] = ['impressions', 'maps', 'search', 'mobile', 'desktop', 'calls', 'website_clicks', 'direction_requests', 'conversations', 'bookings', 'actions'];
const pickTotals = <T>(source: Record<keyof AuditPerformanceTotals, T>): Record<keyof AuditPerformanceTotals, T> =>
	Object.fromEntries(TOTAL_KEYS.map((k) => [k, source[k]])) as Record<keyof AuditPerformanceTotals, T>;
const pass = <T>(part: { available: boolean } | null | undefined, map: (p: never) => T): Part<T> => {
	if (!part) return off('not_synced_yet');
	if (!part.available) return off((part as unknown as PartUnavailable).reason);
	return map(part as never);
};

// ---- NAP (name / phone / website) consistency ----

export const napCheck = (location: LocationForNap, profile: Pick<GbpProfileSummary, 'title' | 'primary_phone' | 'website'>) => {
	const row = (field: 'name' | 'phone' | 'website', a: string | null, b: string | null, norm: (v: string | null) => string | null) => {
		const x = norm(a);
		const y = norm(b);
		return { field, location: a || null, profile: b || null, match: x && y ? x === y : null };
	};
	return [
		row('name', location.name, profile.title, normaliseName),
		row('phone', location.mobile, profile.primary_phone, normalisePhone),
		row('website', location.website_URL, profile.website, normaliseWebsite),
	];
};

export const buildGbpAuditData = (
	report: ReportForAudit,
	profile: GbpProfileSummary | null,
	location: LocationForNap,
	range: ReportRangeParam,
	sections: readonly string[],
): GbpAuditData => {
	const want = (s: Section) => sections.includes(s);
	const data: GbpAuditData = { available: true, generated_at: report.generated_at, range, v4_enabled: report.v4_enabled };
	const score = report.gbp_score;

	if (want('score')) {
		data.score = pass(score, (s: Extract<GbpReportData['gbp_score'], { available: true }>) => ({
			score: s.score,
			grade: s.grade,
			partial: s.partial,
			version: s.version ?? 1,
			counts: s.counts ?? countStates(s.checks.map((c) => ({ state: c.state ?? stateOf(c) }))),
			excluded_pillars: [...s.excluded_pillars],
			pillars: s.pillars.map((p) => {
				const counts = p.counts ?? countStates(s.checks.filter((c) => c.pillar === p.id).map((c) => ({ state: c.state ?? stateOf(c) })));
				return { id: p.id, weight: p.weight, score: p.score, available: p.available, state: p.state ?? (p.available ? 'partial' : 'not_available'), counts };
			}),
		}));
	}
	if (want('checks')) {
		data.checks = pass(score, (s: Extract<GbpReportData['gbp_score'], { available: true }>) => ({
			checks: s.checks.map((c) => ({
				label: c.label,
				pillar: c.pillar,
				status: c.status,
				state: c.state ?? stateOf(c),
				points: c.points,
				max: c.max,
				detail: c.detail,
				fix_hint: c.fix_hint,
				why_it_matters: c.why_it_matters ?? null,
			})),
			top_fixes: s.top_fixes.map((c) => ({ label: c.label, pillar: c.pillar, fix_hint: c.fix_hint })),
		}));
	}
	if (want('performance')) {
		data.performance = pass(report.performance, (p: Extract<GbpReportData['performance'], { available: true }>) => {
			const r = p.ranges[range];
			if (!r) return off('no_data') as never;
			return {
				start: r.start,
				end: r.end,
				days: r.days,
				totals: pickTotals(r.totals),
				previous_change: pickTotals(r.previous_period.change),
				last_year_change: pickTotals(r.same_period_last_year.change),
				by_surface: { ...r.by_surface },
				by_device: { ...r.by_device },
				actions_per_1000: r.actions_per_1000_impressions,
				actions_per_1000_change: r.actions_per_1000_change,
				by_day: r.by_day.map((d) => ({
					date: d.date,
					impressions: d.impressions,
					maps: d.maps,
					search: d.search,
					actions: d.actions,
					calls: d.calls,
					website_clicks: d.website_clicks,
					direction_requests: d.direction_requests,
				})),
			};
		});
	}
	if (want('keywords')) {
		data.keywords = pass(report.keywords, (k: Extract<GbpReportData['keywords'], { available: true }>) => ({
			latest_month: k.latest_month,
			top: k.top.slice(0, KEYWORDS_TOP).map((t) => ({ keyword: t.keyword, value: t.value, threshold: t.threshold, change: t.change, tracked: t.tracked })),
		}));
	}
	if (want('profile')) {
		data.profile = profile
			? {
					title: profile.title,
					primary_category: profile.primary_category,
					additional_categories: [...(profile.additional_categories ?? [])],
					phone: profile.primary_phone,
					website: profile.website,
					hours_set: (profile.regular_hours ?? []).length > 0,
					description_length: (profile.description ?? '').length,
					nap: napCheck(location, profile),
				}
			: off(report.verification && !report.verification.available ? (report.verification as PartUnavailable).reason : 'not_synced_yet');
	}
	if (want('verification')) {
		data.verification = pass(report.verification, (v: Extract<GbpReportData['verification'], { available: true }>) => ({
			verified: v.has_voice_of_merchant,
			state: v.state,
			// 2026-10-02: from Google's verification history.
			verified_at: v.verified_at ?? null,
			method: v.latest?.method ?? null,
			guidance: v.guidance ?? null,
		}));
	}
	if (want('pending_edits')) {
		data.pending_edits = pass(report.pending_google_edits, (e: Extract<GbpReportData['pending_google_edits'], { available: true }>) => ({
			has_pending: e.has_pending,
			fields: [...new Set([...(e.diff_fields ?? []), ...(e.pending_fields ?? [])])],
		}));
	}
	if (want('reviews_media_posts')) {
		data.reviews_media_posts = {
			reviews: pass(report.reviews, (r: Extract<GbpReportData['reviews'], { available: true }>) => ({
				average_rating: r.average_rating,
				total: r.total,
				new_90d: r.new_90d,
				reply_rate_90d: r.reply_rate_90d,
				median_reply_hours: r.median_reply_hours,
				unreplied: r.unreplied.length,
			})),
			media: pass(report.media, (m: Extract<GbpReportData['media'], { available: true }>) => ({
				owner_count: m.owner_count,
				customer_count: m.customer_count,
				latest_owner_upload: m.latest_owner_upload,
			})),
			posts: pass(report.posts, (p: Extract<GbpReportData['posts'], { available: true }>) => ({
				last_post_at: p.last_post_at,
				last_30_days: p.last_30_days,
				last_90_days: p.last_90_days,
			})),
		};
	}
	return data;
};
