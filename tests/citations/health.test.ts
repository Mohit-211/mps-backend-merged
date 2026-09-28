import { citationHealth, entryWeight, gradeFor, HealthEntry } from '../../src/citations/health';

// The worked example of docs/plans/phase-16-citations.md §5 (approved by Mohit, 2026-09-27).

const example: HealthEntry[] = [
	{ status: 'live_correct', directory_type: 'general', authority: 93 }, // Yelp
	{ status: 'nap_wrong', directory_type: 'aggregator', authority: 80 }, // Data Axle
	{ status: 'not_found', directory_type: 'niche', authority: 70 }, // Avvo
	{ status: 'submitted', directory_type: 'general', authority: 85 }, // Yellow Pages
	{ status: 'live_correct', directory_type: 'social', authority: 96 }, // Facebook
	{ status: 'not_checked', directory_type: 'general', authority: 90 }, // BBB
];

describe('citationHealth', () => {
	it('scores the worked example 50 (D) with 0.83 coverage', () => {
		const h = citationHealth(example);
		expect(h).toMatchObject({ score: 50, grade: 'D', coverage: 0.83, scored: 5, total: 6 });
		expect(h.counts).toMatchObject({ live_correct: 2, nap_wrong: 1, not_found: 1, submitted: 1, not_checked: 1, removed: 0 });
	});

	it('fixing the Data Axle NAP raises it to 66 (C)', () => {
		const fixed = example.map((e, i) => (i === 1 ? { ...e, status: 'live_correct' as const } : e));
		expect(citationHealth(fixed)).toMatchObject({ score: 66, grade: 'C' });
	});

	it('weights: type × (1 + 0.5 × authority/100); no authority → type weight', () => {
		expect(entryWeight('general', 93)).toBeCloseTo(1.465, 5);
		expect(entryWeight('aggregator', 80)).toBeCloseTo(2.1, 5);
		expect(entryWeight('social', null)).toBe(0.8);
		expect(entryWeight('niche', 250)).toBeCloseTo(1.8, 5); // authority clamped to 100
	});

	it('nothing scored → null score and grade; removed entries leave coverage', () => {
		expect(citationHealth([])).toMatchObject({ score: null, grade: null, coverage: null, total: 0 });
		const unchecked = citationHealth([{ status: 'not_checked', directory_type: 'general', authority: null }]);
		expect(unchecked).toMatchObject({ score: null, grade: null, coverage: 0 });
		const removed = citationHealth([
			{ status: 'removed', directory_type: 'general', authority: null },
			{ status: 'live_correct', directory_type: 'general', authority: null },
		]);
		expect(removed).toMatchObject({ score: 100, grade: 'A', coverage: 1, scored: 1, total: 2 });
	});

	it('grade bands match the GBP Score', () => {
		expect([85, 84, 70, 55, 54, 40, 39, 0].map(gradeFor)).toEqual(['A', 'B', 'B', 'C', 'D', 'D', 'F', 'F']);
	});
});
