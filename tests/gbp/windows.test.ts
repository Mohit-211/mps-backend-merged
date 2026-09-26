import { dailyWindow, keywordMonths, toIsoDate, toIsoMonth } from '../../src/gbp/windows';

const settings = { backfillMonths: 18, rollingDays: 40, keywordBackfillMonths: 6, keywordRollingMonths: 2 };

describe('GBP sync windows', () => {
	it('rolling daily window: 40 days ending yesterday (UTC)', () => {
		const w = dailyWindow(new Date('2026-09-26T03:00:00Z'), false, settings);
		expect(toIsoDate(w.end)).toBe('2026-09-25');
		expect(toIsoDate(w.start)).toBe('2026-08-17'); // 40 days inclusive
	});

	it('backfill daily window: 18 months ending yesterday', () => {
		const w = dailyWindow(new Date('2026-09-26T03:00:00Z'), true, settings);
		expect(toIsoDate(w.start)).toBe('2025-03-26');
		expect(toIsoDate(w.end)).toBe('2026-09-25');
	});

	it('crosses a year boundary', () => {
		const w = dailyWindow(new Date('2027-01-05T00:30:00Z'), false, settings);
		expect(toIsoDate(w.end)).toBe('2027-01-04');
		expect(toIsoDate(w.start)).toBe('2026-11-26');
	});

	it('keywords: the last 2 complete months, never the current one', () => {
		expect(keywordMonths(new Date('2026-09-26T00:00:00Z'), false, settings).map(toIsoMonth)).toEqual(['2026-07', '2026-08']);
		expect(keywordMonths(new Date('2027-01-01T00:00:00Z'), false, settings).map(toIsoMonth)).toEqual(['2026-11', '2026-12']);
	});

	it('keywords backfill: the last 6 complete months', () => {
		expect(keywordMonths(new Date('2026-03-10T00:00:00Z'), true, settings).map(toIsoMonth)).toEqual([
			'2025-09',
			'2025-10',
			'2025-11',
			'2025-12',
			'2026-01',
			'2026-02',
		]);
	});
});
