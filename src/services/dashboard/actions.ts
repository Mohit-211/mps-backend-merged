import { ILocationSummary } from '../../models';
import { LocationStatus } from '../locations/status';

// Recommended actions for the dashboards (Phase 11), pure. Candidates come from each location's stored
// summary and status; each has an impact in 0–1; the top MAX_ACTIONS are returned, highest first.

export const MAX_ACTIONS = 5;

export interface ActionLocation {
	location_id: string;
	name: string;
	status: LocationStatus;
	summary: Partial<ILocationSummary> | null | undefined;
}

export interface RecommendedAction {
	id: string;
	source: 'gbp' | 'ranking' | 'setup' | 'connection' | 'citations';
	location_id: string;
	location_name: string;
	title: string;
	detail: string;
	impact: number;
}

const clamp = (v: number): number => Math.max(0, Math.min(1, Math.round(v * 100) / 100));

export const candidateActions = (l: ActionLocation): RecommendedAction[] => {
	const base = { location_id: l.location_id, location_name: l.name };
	const out: RecommendedAction[] = [];
	if (l.status === 'reconnect_required') {
		out.push({ ...base, id: 'connection:reconnect', source: 'connection', title: 'Reconnect Google', detail: 'The Google connection for this location was revoked; GBP data is no longer updated.', impact: 0.95 });
	}
	if (l.status === 'setup_required') {
		out.push({ ...base, id: 'setup:finish', source: 'setup', title: 'Finish setting up this location', detail: 'Add keywords and competitors and complete setup to start tracking.', impact: 0.9 });
	}
	const s = l.summary;
	if (!s) return out;
	for (const d of s.declines ?? []) {
		if (d.label === 'dropped_out_of_top_60') {
			out.push({ ...base, id: `ranking:dropped:${d.keyword}`, source: 'ranking', title: `"${d.keyword}" dropped out of the top 60`, detail: 'Check the profile relevance for this keyword (categories, services, description, posts).', impact: 0.8 });
		}
	}
	const worst = (s.declines ?? []).find((d) => d.label === 'declined' && typeof d.change === 'number');
	if (worst && typeof worst.change === 'number') {
		out.push({ ...base, id: `ranking:declined:${worst.keyword}`, source: 'ranking', title: `"${worst.keyword}" lost ${Math.abs(worst.change)} positions`, detail: 'Compare with the competitors that rank above you for this keyword.', impact: clamp(Math.abs(worst.change) / 10) });
	}
	const kc = s.key_competitor;
	if (kc?.ahead && typeof kc.avg_rank === 'number') {
		const gap = typeof kc.self_avg_rank === 'number' ? kc.self_avg_rank - kc.avg_rank : 20;
		out.push({ ...base, id: 'ranking:competitor_ahead', source: 'ranking', title: `${kc.name ?? 'A competitor'} ranks ahead of you`, detail: `Average rank ${kc.avg_rank} vs your ${kc.self_avg_rank ?? '60+'}. Compare their reviews, categories and posts.`, impact: clamp(gap / 20) });
	}
	for (const f of s.top_fixes ?? []) {
		out.push({ ...base, id: `gbp:${f.id}`, source: 'gbp', title: f.label, detail: f.fix_hint ?? '', impact: clamp(f.lost / 20) });
	}
	// Phase 16: citations with a wrong NAP, and directories where the business isn't listed.
	const napWrong = s.citation_counts?.nap_wrong ?? 0;
	if (napWrong > 0) {
		out.push({ ...base, id: 'citations:nap_wrong', source: 'citations', title: `${napWrong} listing${napWrong === 1 ? '' : 's'} show${napWrong === 1 ? 's' : ''} the wrong name, address or phone`, detail: 'Inconsistent NAP across directories weakens local rankings. See the citation table for the fields to fix.', impact: clamp(0.3 + 0.1 * napWrong) });
	}
	const notFound = s.citation_counts?.not_found ?? 0;
	if (notFound > 0) {
		out.push({ ...base, id: 'citations:not_found', source: 'citations', title: `Not listed on ${notFound} director${notFound === 1 ? 'y' : 'ies'}`, detail: 'Getting listed on the missing directories adds citations Google can use to confirm the business.', impact: clamp(notFound / 20) });
	}
	return out;
};

export const recommendedActions = (locations: ActionLocation[]): RecommendedAction[] =>
	locations
		.flatMap(candidateActions)
		.filter((a) => a.impact > 0)
		.sort((a, b) => b.impact - a.impact || a.location_name.localeCompare(b.location_name) || a.id.localeCompare(b.id))
		.slice(0, MAX_ACTIONS);
