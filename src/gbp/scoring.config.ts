// Every weight and threshold of the GBP Score and the Public Score (Phase 7c). Starting values;
// they are calibrated against real data once GBP access is approved (docs/PROGRESS.md, 7c
// "Scoring calibration"). Change them here only, with Mohit's approval.

/** `value >= min` earns `points`; bands are checked top-down and the first match wins. */
export interface MinBand {
	min: number;
	points: number;
}

/** `value <= max` earns `points`; bands are checked top-down and the first match wins. */
export interface MaxBand {
	max: number;
	points: number;
}

export const PILLARS = ['completeness', 'activity', 'reviews', 'visibility', 'engagement'] as const;
export type PillarId = (typeof PILLARS)[number];

export const PILLAR_WEIGHTS: Record<PillarId, number> = {
	completeness: 25,
	activity: 20,
	reviews: 25,
	visibility: 20,
	engagement: 10,
};

export const GRADES: { min: number; grade: 'A' | 'B' | 'C' | 'D' | 'F' }[] = [
	{ min: 85, grade: 'A' },
	{ min: 70, grade: 'B' },
	{ min: 55, grade: 'C' },
	{ min: 40, grade: 'D' },
	{ min: 0, grade: 'F' },
];

export const TOP_FIXES = 5;

export const GBP_SCORE = {
	completeness: {
		verified: 5,
		description: { max: 3, fullChars: 250, partialPoints: 1 },
		additionalCategories: 2,
		regularHours: 3,
		specialHours: { max: 2, windowDays: 60 },
		website: 2,
		phone: 2,
		attributes: { max: 2, min: 5 },
		serviceItems: 2,
		noPendingEdits: 2,
	},
	activity: {
		recentPost: { max: 6, days: 7 },
		postsPerMonth: { max: 5, bands: [{ min: 4, points: 5 }, { min: 2, points: 3 }, { min: 1, points: 1 }] as MinBand[] },
		recentOwnerPhoto: { max: 5, days: 30 },
		ownerPhotos: { max: 4, bands: [{ min: 20, points: 4 }, { min: 10, points: 2 }, { min: 1, points: 1 }] as MinBand[] },
	},
	reviews: {
		averageRating: {
			max: 7,
			bands: [{ min: 4.7, points: 7 }, { min: 4.5, points: 6 }, { min: 4.2, points: 4 }, { min: 4.0, points: 2 }] as MinBand[],
		},
		total: {
			max: 5,
			bands: [{ min: 100, points: 5 }, { min: 50, points: 4 }, { min: 20, points: 3 }, { min: 10, points: 2 }, { min: 1, points: 1 }] as MinBand[],
		},
		new30: { max: 3, bands: [{ min: 4, points: 3 }, { min: 2, points: 2 }, { min: 1, points: 1 }] as MinBand[] },
		new90: { max: 2, bands: [{ min: 10, points: 2 }, { min: 3, points: 1 }] as MinBand[] },
		replyRate90d: { max: 5, bands: [{ min: 0.8, points: 5 }, { min: 0.5, points: 3 }, { min: 0.000001, points: 1 }] as MinBand[] },
		medianReplyHours: { max: 3, bands: [{ max: 24, points: 3 }, { max: 48, points: 2 }, { max: 168, points: 1 }] as MaxBand[] },
	},
	visibility: {
		overallAvgRank: {
			max: 8,
			bands: [{ max: 3, points: 8 }, { max: 5, points: 7 }, { max: 10, points: 5 }, { max: 20, points: 3 }, { max: 40, points: 1 }] as MaxBand[],
		},
		top3Rate: { max: 6, bands: [{ min: 0.6, points: 6 }, { min: 0.4, points: 4 }, { min: 0.2, points: 2 }, { min: 0.000001, points: 1 }] as MinBand[] },
		/** Impressions change (fraction) of the last 28 days vs the previous 28. */
		impressionsTrend: { max: 6, bands: [{ min: 0.1, points: 6 }, { min: 0, points: 4 }, { min: -0.1, points: 2 }] as MinBand[] },
	},
	engagement: {
		actionsPer1000: { max: 5, bands: [{ min: 50, points: 5 }, { min: 30, points: 4 }, { min: 15, points: 3 }, { min: 5, points: 1 }] as MinBand[] },
		actionsTrend: { max: 5, bands: [{ min: 0.1, points: 5 }, { min: 0, points: 3 }, { min: -0.1, points: 1 }] as MinBand[] },
	},
	/** A comparison window needs at least this share of days with data. */
	minCoverage: 0.8,
	/** The window of the score's performance checks. */
	performanceDays: 28,
};

export const PUBLIC_SCORE = {
	rating: { max: 25, bands: [{ min: 4.7, points: 25 }, { min: 4.5, points: 21 }, { min: 4.2, points: 15 }, { min: 4.0, points: 10 }, { min: 3.5, points: 5 }] as MinBand[] },
	reviewCount: {
		max: 20,
		bands: [{ min: 200, points: 20 }, { min: 100, points: 16 }, { min: 50, points: 12 }, { min: 20, points: 8 }, { min: 5, points: 4 }, { min: 1, points: 2 }] as MinBand[],
	},
	/** Mean center rank across keywords; a keyword where the business isn't in the top 20 counts as 21. */
	centerRank: { max: 20, missingRank: 21, bands: [{ max: 3, points: 20 }, { max: 5, points: 16 }, { max: 10, points: 11 }, { max: 20, points: 5 }] as MaxBand[] },
	/** Share of keywords where the business is top 3 at the center, times this. */
	centerTop3: { max: 10 },
	/** Each public profile field present earns this. */
	profileField: 5,
	profileFields: ['primary_category', 'hours', 'website', 'phone', 'editorial_summary'] as const,
};

/** Place Details fields for the comparison (Enterprise SKU). editorialSummary is Atmosphere-tier: behind a flag. */
export const COMPETITOR_DETAILS_FIELDS = [
	'id',
	'displayName',
	'rating',
	'userRatingCount',
	'primaryType',
	'primaryTypeDisplayName',
	'types',
	'regularOpeningHours',
	'websiteUri',
	'nationalPhoneNumber',
	'businessStatus',
] as const;

export const MAX_COMPETITORS = 5;
/** Non-client businesses taken from the latest map list (first keyword, center). */
export const MAP_LIST_COMPETITORS = 3;
export const MAX_INSIGHTS = 5;
export const SCORE_HISTORY_MAX = 24;

export const minBand = (value: number, bands: MinBand[]): number => bands.find((b) => value >= b.min)?.points ?? 0;
export const maxBand = (value: number, bands: MaxBand[]): number => bands.find((b) => value <= b.max)?.points ?? 0;
export const gradeFor = (score: number): (typeof GRADES)[number]['grade'] => (GRADES.find((g) => score >= g.min) ?? GRADES[GRADES.length - 1]).grade;
