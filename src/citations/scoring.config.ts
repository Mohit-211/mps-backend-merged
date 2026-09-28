import { CitationStatus, DirectoryType } from './constants';

// Citation Health score (Phase 16): every weight in one place, like src/gbp/scoring.config.ts. Defaults
// approved by Mohit on 2026-09-27 (worked example in docs/plans/phase-16-citations.md §5: 50 → D, and 66 → C
// after one NAP fix). Change them here only, with Mohit's approval.

/** Points an entry earns by status (0–1). Statuses not listed here are excluded from the score. */
export const STATUS_POINTS: Partial<Record<CitationStatus, number>> = {
	live_correct: 1,
	nap_wrong: 0.4,
	duplicate: 0.3,
	submitted: 0.3,
	pending: 0.3,
	not_found: 0,
};

/** Not scored: `not_checked` lowers coverage instead; `removed` (listing taken down on purpose) doesn't count at all. */
export const EXCLUDED_STATUSES: CitationStatus[] = ['not_checked', 'removed'];

export const TYPE_WEIGHTS: Record<DirectoryType, number> = {
	aggregator: 1.5,
	niche: 1.2,
	general: 1,
	government_chamber: 1,
	social: 0.8,
};

/** weight × (1 + factor × authority / 100); a directory without authority keeps × 1. */
export const AUTHORITY = { enabled: true, factor: 0.5 };

/** The same bands as the GBP Score. */
export const GRADES: { min: number; grade: 'A' | 'B' | 'C' | 'D' | 'F' }[] = [
	{ min: 85, grade: 'A' },
	{ min: 70, grade: 'B' },
	{ min: 55, grade: 'C' },
	{ min: 40, grade: 'D' },
	{ min: 0, grade: 'F' },
];

/** Fewer scored entries than this → no score ("not available"). */
export const MIN_SCORED = 1;
