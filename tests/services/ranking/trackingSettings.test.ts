import {
	applyTrackingUpdate,
	defaultTracking,
	normaliseKeywords,
	sameKeywordSet,
	validateCompetitors,
	withDefaults,
} from '../../../src/services/ranking/trackingSettings';
import { planRun } from '../../../src/services/ranking/runPlan';

const NOW = new Date('2026-09-26T10:00:00Z');
const OWN = 'ChIJownPlaceIdOfClient01';
const C1 = 'ChIJcompetitorNumberOne1';
const C2 = 'ChIJcompetitorNumberTwo2';

describe('normaliseKeywords', () => {
	it('trims, collapses spaces, de-duplicates on the normalized form and keeps the first spelling', () => {
		expect(normaliseKeywords(['  Emergency   Plumber ', 'emergency plumber', 'Drain Cleaning'], 20)).toEqual([
			{ text: 'Emergency Plumber', normalized: 'emergency plumber' },
			{ text: 'Drain Cleaning', normalized: 'drain cleaning' },
		]);
	});

	it('enforces 2–80 characters per keyword', () => {
		expect(() => normaliseKeywords(['a'], 20)).toThrow('2-80 characters');
		expect(() => normaliseKeywords(['x'.repeat(81)], 20)).toThrow('2-80 characters');
		expect(normaliseKeywords(['ab', 'x'.repeat(80)], 20)).toHaveLength(2);
	});

	it('requires at least one and at most RANK_MAX_KEYWORDS keywords (after de-dup)', () => {
		expect(() => normaliseKeywords([], 20)).toThrow('At least one keyword');
		expect(() => normaliseKeywords(['aa', 'bb', 'cc'], 2)).toThrow('At most 2 keywords');
		expect(normaliseKeywords(['aa', 'AA', 'bb'], 2)).toHaveLength(2);
	});
});

describe('sameKeywordSet', () => {
	const k = (...n: string[]) => n.map((normalized) => ({ normalized }));
	it('ignores order', () => {
		expect(sameKeywordSet(k('a', 'b'), k('b', 'a'))).toBe(true);
	});
	it('detects additions, removals and replacements', () => {
		expect(sameKeywordSet(k('a', 'b'), k('a'))).toBe(false);
		expect(sameKeywordSet(k('a'), k('a', 'b'))).toBe(false);
		expect(sameKeywordSet(k('a', 'b'), k('a', 'c'))).toBe(false);
	});
});

describe('validateCompetitors', () => {
	it('accepts up to 5 unique place IDs (with or without the places/ prefix)', () => {
		expect(validateCompetitors([C1, `places/${C2}`, C1], OWN)).toEqual([C1, C2]);
	});
	it('rejects the location’s own place_id', () => {
		expect(() => validateCompetitors([OWN], OWN)).toThrow("own place_id");
	});
	it('rejects malformed IDs and more than 5', () => {
		expect(() => validateCompetitors(['short'], OWN)).toThrow('Invalid competitor');
		expect(() => validateCompetitors(['has spaces in it!!'], OWN)).toThrow('Invalid competitor');
		const six = Array.from({ length: 6 }, (_, i) => `ChIJcompetitorNumber00${i}`);
		expect(() => validateCompetitors(six, OWN)).toThrow('At most 5');
	});
});

describe('applyTrackingUpdate', () => {
	const base = withDefaults(null);

	it('first keyword set is version 1 (no bump)', () => {
		const { tracking, keywordsVersionBumped } = applyTrackingUpdate(base, { keywords: ['Plumber'] }, OWN, NOW, 20);
		expect(tracking.keywords_version).toBe(1);
		expect(keywordsVersionBumped).toBe(false);
		expect(tracking.keywords_updated_at).toEqual(NOW);
	});

	it('bumps the version only when the keyword SET changes', () => {
		const v1 = applyTrackingUpdate(base, { keywords: ['Plumber', 'Drain cleaning'] }, OWN, NOW, 20).tracking;
		const reordered = applyTrackingUpdate(v1, { keywords: ['drain  CLEANING', 'plumber'] }, OWN, NOW, 20);
		expect(reordered.keywordsVersionBumped).toBe(false);
		expect(reordered.tracking.keywords_version).toBe(1);
		const changed = applyTrackingUpdate(v1, { keywords: ['Plumber', 'Water heater'] }, OWN, NOW, 20);
		expect(changed.keywordsVersionBumped).toBe(true);
		expect(changed.tracking.keywords_version).toBe(2);
	});

	it('leaves fields that are not sent unchanged', () => {
		const v1 = applyTrackingUpdate(base, { keywords: ['Plumber'], competitors: [C1] }, OWN, NOW, 20).tracking;
		const next = applyTrackingUpdate(v1, { grid: { size: 7, spacing_km: 2 } }, OWN, NOW, 20).tracking;
		expect(next.keywords).toEqual(v1.keywords);
		expect(next.competitors).toEqual([C1]);
		expect(next.grid).toEqual({ size: 7, spacing_km: 2 });
	});

	it('frequency is auto_monthly by default; manual_only can be set and back', () => {
		expect(defaultTracking().frequency).toBe('auto_monthly');
		const manual = applyTrackingUpdate(base, { frequency: 'manual_only' }, OWN, NOW, 20).tracking;
		expect(manual.frequency).toBe('manual_only');
		expect(applyTrackingUpdate(manual, { frequency: 'auto_monthly' }, OWN, NOW, 20).tracking.frequency).toBe('auto_monthly');
	});

	it('maps pre-7b stored frequencies on read', () => {
		type Stored = Parameters<typeof withDefaults>[0];
		expect(withDefaults({ frequency: 'weekly' } as unknown as Stored).frequency).toBe('auto_monthly');
		expect(withDefaults({ frequency: 'monthly' } as unknown as Stored).frequency).toBe('auto_monthly');
		expect(withDefaults({ frequency: 'manual' } as unknown as Stored).frequency).toBe('manual_only');
	});
});

describe('planRun', () => {
	const tracking = {
		...defaultTracking(),
		keywords: normaliseKeywords(['plumber', 'drain cleaning', 'water heater'], 20),
		grid: { size: 7, spacing_km: 1 },
	};
	const center = { lat: 43.6629, lng: -79.3347 };

	it('in development: at most RANK_DEV_MAX_KEYWORDS keywords and a 3×3 grid', () => {
		const plan = planRun(center, tracking, { env: 'development', devMaxKeywords: 2 });
		expect(plan).toMatchObject({ gridSize: 3, devCapped: true, needsCenterResolution: false });
		expect(plan.keywords.map((k) => k.normalized)).toEqual(['plumber', 'drain cleaning']);
		expect(plan.estimate.idsOnly).toEqual({ min: 26, max: 78, maxWithRetries: 156 });
	});

	it('in production: the configured grid and all keywords', () => {
		const plan = planRun(center, tracking, { env: 'production' });
		expect(plan).toMatchObject({ gridSize: 7, devCapped: false });
		expect(plan.estimate.points).toBe(53);
		expect(plan.estimate.idsOnly.max).toBe(53 * 3 * 3);
	});

	it('flags runs over RANK_MAX_CALLS_PER_RUN', () => {
		expect(planRun(center, tracking, { env: 'production', maxCallsPerRun: 400 }).overCap).toBe(true);
		expect(planRun(center, tracking, { env: 'production', maxCallsPerRun: 3200 }).overCap).toBe(false);
	});

	it('adds the center-resolution Details call when the location has no lat/lng', () => {
		const plan = planRun({ lat: null, lng: null }, tracking, { env: 'production' });
		expect(plan.needsCenterResolution).toBe(true);
		expect(plan.estimate.details.min).toBe(1);
	});
});
