import { CITATION_STATUSES, CitationStatus, DirectoryType } from './constants';
import { AUTHORITY, EXCLUDED_STATUSES, GRADES, MIN_SCORED, STATUS_POINTS, TYPE_WEIGHTS } from './scoring.config';

// Citation Health (Phase 16), pure. Score = round(100 × Σ wᵢ·pointsᵢ / Σ wᵢ) over scored entries;
// coverage = scored / (entries − removed). The formula and weights are in scoring.config.ts.

export interface HealthEntry {
	status: CitationStatus;
	directory_type: DirectoryType;
	authority: number | null;
}

export type StatusCounts = Record<CitationStatus, number>;

export interface CitationHealth {
	/** 0–100, or null with fewer than MIN_SCORED scored entries. */
	score: number | null;
	grade: 'A' | 'B' | 'C' | 'D' | 'F' | null;
	/** 0–1 (2 decimals), or null when every entry is removed / there are none. */
	coverage: number | null;
	counts: StatusCounts;
	scored: number;
	total: number;
}

export const emptyCounts = (): StatusCounts => Object.fromEntries(CITATION_STATUSES.map((s) => [s, 0])) as StatusCounts;

export const entryWeight = (type: DirectoryType, authority: number | null): number => {
	const base = TYPE_WEIGHTS[type] ?? 1;
	if (!AUTHORITY.enabled || authority === null || authority === undefined) return base;
	const a = Math.max(0, Math.min(100, authority));
	return base * (1 + (AUTHORITY.factor * a) / 100);
};

export const gradeFor = (score: number): CitationHealth['grade'] => GRADES.find((g) => score >= g.min)?.grade ?? 'F';

export const citationHealth = (entries: HealthEntry[]): CitationHealth => {
	const counts = emptyCounts();
	let weightSum = 0;
	let pointsSum = 0;
	let scored = 0;
	for (const e of entries) {
		counts[e.status] += 1;
		const points = STATUS_POINTS[e.status];
		if (EXCLUDED_STATUSES.includes(e.status) || points === undefined) continue;
		const w = entryWeight(e.directory_type, e.authority);
		weightSum += w;
		pointsSum += w * points;
		scored += 1;
	}
	const countable = entries.length - counts.removed;
	const score = scored >= MIN_SCORED && weightSum > 0 ? Math.round((100 * pointsSum) / weightSum) : null;
	return {
		score,
		grade: score === null ? null : gradeFor(score),
		coverage: countable > 0 ? Math.round((scored / countable) * 100) / 100 : null,
		counts,
		scored,
		total: entries.length,
	};
};
