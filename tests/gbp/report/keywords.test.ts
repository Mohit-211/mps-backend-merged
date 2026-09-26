import { keywordsSection } from '../../../src/gbp/report/keywords';

describe('keywordsSection', () => {
	const rows = [
		{ month: '2026-07', keyword: 'plumber dallas', value: 120, threshold: null },
		{ month: '2026-07', keyword: 'emergency plumber', value: null, threshold: 15 },
		{ month: '2026-08', keyword: 'plumber dallas', value: 150, threshold: null },
		{ month: '2026-08', keyword: 'Emergency Plumber', value: 40, threshold: null },
		{ month: '2026-08', keyword: 'water heater repair', value: null, threshold: 15 },
		{ month: '2026-08', keyword: 'drain cleaning', value: 12, threshold: null },
	];

	it('latest month ranked: exact values first, thresholds after; thresholds never become numbers', () => {
		const s = keywordsSection(rows, ['Plumber Dallas']);
		expect(s?.months).toEqual(['2026-07', '2026-08']);
		expect(s?.top.map((k) => k.keyword)).toEqual(['plumber dallas', 'Emergency Plumber', 'drain cleaning', 'water heater repair']);
		expect(s?.top[3]).toMatchObject({ value: null, threshold: 15, change: null });
	});

	it('change only between two exact values; tracked keywords matched case-insensitively', () => {
		const s = keywordsSection(rows, ['Plumber Dallas']);
		expect(s?.top[0]).toMatchObject({ previous_value: 120, change: 30, tracked: true });
		expect(s?.top[1]).toMatchObject({ previous_value: null, change: null, tracked: false }); // previous was a threshold
		expect(s?.not_tracked).toEqual(['Emergency Plumber', 'drain cleaning', 'water heater repair']);
	});

	it('null without rows', () => {
		expect(keywordsSection([], [])).toBeNull();
	});
});
