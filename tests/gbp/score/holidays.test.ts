import { easterSunday, holidaysForYear, upcomingHolidays } from '../../../src/gbp/score/holidays';

describe('holidays', () => {
	it.each([
		[2024, 3, 31],
		[2025, 4, 20],
		[2026, 4, 5],
		[2027, 3, 28],
	])('Easter %i is %i/%i', (year, month, day) => {
		expect(easterSunday(year)).toEqual({ month, day });
	});

	it('US moving holidays', () => {
		const dates = Object.fromEntries(holidaysForYear('US', 2026).map((h) => [h.name, h.date]));
		expect(dates).toMatchObject({
			'Memorial Day': '2026-05-25',
			'Labor Day': '2026-09-07',
			Thanksgiving: '2026-11-26',
			'Independence Day': '2026-07-04',
		});
	});

	it('Canadian holidays', () => {
		const dates = Object.fromEntries(holidaysForYear('CA', 2026).map((h) => [h.name, h.date]));
		expect(dates).toMatchObject({
			'Good Friday': '2026-04-03',
			'Victoria Day': '2026-05-18',
			'Canada Day': '2026-07-01',
			'Labour Day': '2026-09-07',
			Thanksgiving: '2026-10-12',
			'Boxing Day': '2026-12-26',
		});
		// Victoria Day when May 24 is itself a Monday (2027).
		expect(holidaysForYear('CA', 2027).find((h) => h.name === 'Victoria Day')?.date).toBe('2027-05-24');
	});

	it('upcoming window spans a year end, inclusive', () => {
		const names = upcomingHolidays('US', new Date('2026-12-20T12:00:00Z'), 12).map((h) => `${h.date} ${h.name}`);
		expect(names).toEqual(['2026-12-24 Christmas Eve', '2026-12-25 Christmas Day', "2026-12-31 New Year's Eve", "2027-01-01 New Year's Day"]);
		expect(upcomingHolidays('US', new Date('2026-08-01T00:00:00Z'), 20)).toEqual([]);
	});
});
