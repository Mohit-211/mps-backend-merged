import { MetricRow, changeOf, performanceSection, scorePerformance } from '../../../src/gbp/report/performance';

const days = (end: string, count: number): string[] => {
	const out: string[] = [];
	const e = new Date(`${end}T00:00:00Z`).getTime();
	for (let i = count - 1; i >= 0; i -= 1) out.push(new Date(e - i * 86_400_000).toISOString().slice(0, 10));
	return out;
};

/** Every day: 100 mobile-maps, 50 desktop-search impressions, 3 calls, 2 website clicks. */
const rowsFor = (dates: string[], scale = 1): MetricRow[] =>
	dates.flatMap((date) => [
		{ date, metric: 'BUSINESS_IMPRESSIONS_MOBILE_MAPS', value: 100 * scale },
		{ date, metric: 'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH', value: 50 * scale },
		{ date, metric: 'CALL_CLICKS', value: 3 * scale },
		{ date, metric: 'WEBSITE_CLICKS', value: 2 * scale },
	]);

describe('performanceSection', () => {
	it('null without data', () => {
		expect(performanceSection([])).toBeNull();
	});

	it('totals, splits and actions per 1,000 for the 28-day range ending at the latest date', () => {
		const rows = [...rowsFor(days('2026-08-27', 28)), ...rowsFor(days('2026-07-30', 28), 0.5)];
		const s = performanceSection(rows);
		const r = s?.ranges['28d'];
		expect(s?.latest_date).toBe('2026-08-27');
		expect(r).toMatchObject({ start: '2026-07-31', end: '2026-08-27', days: 28, coverage: { days_with_data: 28, days: 28 } });
		expect(r?.totals).toMatchObject({ impressions: 4200, maps: 2800, search: 1400, mobile: 2800, desktop: 1400, calls: 84, website_clicks: 56, actions: 140 });
		expect(r?.actions_per_1000_impressions).toBe(33.3);
		expect(r?.previous_period).toMatchObject({ start: '2026-07-03', end: '2026-07-30' });
		expect(r?.previous_period.change.impressions).toBe(1); // doubled
		expect(r?.actions_per_1000_change).toBe(0); // same rate
		expect(r?.by_day).toHaveLength(28);
		expect(r?.by_day[0]).toEqual({ date: '2026-07-31', impressions: 150, maps: 100, search: 50, actions: 5, calls: 3, website_clicks: 2, direction_requests: 0 });
	});

	it('change is null when either period has less than 80 % coverage; missing days count as 0', () => {
		const current = days('2026-08-27', 28);
		const sparsePrevious = days('2026-07-30', 28).slice(0, 20); // 20/28 = 71 %
		const s = performanceSection([...rowsFor(current), ...rowsFor(sparsePrevious)]);
		const r = s?.ranges['28d'];
		expect(r?.previous_period.coverage).toEqual({ days_with_data: 20, days: 28 });
		expect(r?.previous_period.change.impressions).toBeNull();
		expect(r?.actions_per_1000_change).toBeNull();
		expect(scorePerformance(s)).toEqual({ impressions_change: null, actions_per_1000: 33.3, actions_per_1000_change: null });
	});

	it('same period last year crosses a leap day', () => {
		const s = performanceSection(rowsFor(days('2025-03-05', 400)));
		const r = s?.ranges['28d'];
		expect(r).toMatchObject({ start: '2025-02-06', end: '2025-03-05' });
		expect(r?.same_period_last_year).toMatchObject({ start: '2024-02-06', end: '2024-03-05', coverage: { days_with_data: 29, days: 29 } });
		expect(s?.ranges['12m'].days).toBe(365);
	});

	it('actions per 1,000 is null with no impressions', () => {
		const s = performanceSection([{ date: '2026-08-01', metric: 'CALL_CLICKS', value: 4 }]);
		expect(s?.ranges['28d'].actions_per_1000_impressions).toBeNull();
	});
});

describe('changeOf', () => {
	it('fraction with 3 decimals; null on a zero base or without coverage', () => {
		expect(changeOf(110, 100, true)).toBe(0.1);
		expect(changeOf(1, 3, true)).toBe(-0.667);
		expect(changeOf(5, 0, true)).toBeNull();
		expect(changeOf(5, 4, false)).toBeNull();
	});
});
