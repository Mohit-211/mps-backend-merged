// Holidays on which businesses commonly change their hours, for the "special hours set" check.
// US and Canada only (the product's markets). Dates are calendar dates ("YYYY-MM-DD").

export type HolidayCountry = 'US' | 'CA';

export interface Holiday {
	date: string;
	name: string;
}

const iso = (year: number, month: number, day: number): string =>
	`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/** The n-th (1-based) weekday (0 = Sunday) of a month; n = -1 for the last one. */
const nthWeekday = (year: number, month: number, weekday: number, n: number): number => {
	if (n > 0) {
		const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
		return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
	}
	const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
	const last = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay();
	return lastDay - ((last - weekday + 7) % 7);
};

/** Easter Sunday (Gregorian, anonymous algorithm). */
export const easterSunday = (year: number): { month: number; day: number } => {
	const a = year % 19;
	const b = Math.floor(year / 100);
	const c = year % 100;
	const d = Math.floor(b / 4);
	const e = b % 4;
	const f = Math.floor((b + 8) / 25);
	const g = Math.floor((b - f + 1) / 3);
	const h = (19 * a + b - d - g + 15) % 30;
	const i = Math.floor(c / 4);
	const k = c % 4;
	const l = (32 + 2 * e + 2 * i - h - k) % 7;
	const m = Math.floor((a + 11 * h + 22 * l) / 451);
	const month = Math.floor((h + l - 7 * m + 114) / 31);
	const day = ((h + l - 7 * m + 114) % 31) + 1;
	return { month, day };
};

const goodFriday = (year: number): string => {
	const { month, day } = easterSunday(year);
	const date = new Date(Date.UTC(year, month - 1, day - 2));
	return iso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
};

/** Victoria Day: the Monday before May 25. */
const victoriaDay = (year: number): number => {
	const may24 = new Date(Date.UTC(year, 4, 24)).getUTCDay();
	return 24 - ((may24 - 1 + 7) % 7);
};

export const holidaysForYear = (country: HolidayCountry, year: number): Holiday[] => {
	const shared: Holiday[] = [
		{ date: iso(year, 1, 1), name: "New Year's Day" },
		{ date: iso(year, 9, nthWeekday(year, 9, 1, 1)), name: country === 'US' ? 'Labor Day' : 'Labour Day' },
		{ date: iso(year, 12, 24), name: 'Christmas Eve' },
		{ date: iso(year, 12, 25), name: 'Christmas Day' },
		{ date: iso(year, 12, 31), name: "New Year's Eve" },
	];
	const specific: Holiday[] =
		country === 'US'
			? [
					{ date: iso(year, 5, nthWeekday(year, 5, 1, -1)), name: 'Memorial Day' },
					{ date: iso(year, 7, 4), name: 'Independence Day' },
					{ date: iso(year, 11, nthWeekday(year, 11, 4, 4)), name: 'Thanksgiving' },
				]
			: [
					{ date: goodFriday(year), name: 'Good Friday' },
					{ date: iso(year, 5, victoriaDay(year)), name: 'Victoria Day' },
					{ date: iso(year, 7, 1), name: 'Canada Day' },
					{ date: iso(year, 10, nthWeekday(year, 10, 1, 2)), name: 'Thanksgiving' },
					{ date: iso(year, 12, 26), name: 'Boxing Day' },
				];
	return [...shared, ...specific].sort((x, y) => x.date.localeCompare(y.date));
};

/** Holidays from `from` (inclusive) through `from + days` (inclusive), across a year end. */
export const upcomingHolidays = (country: HolidayCountry, from: Date, days: number): Holiday[] => {
	const start = from.toISOString().slice(0, 10);
	const end = new Date(from.getTime() + days * 86_400_000).toISOString().slice(0, 10);
	const years = [from.getUTCFullYear(), from.getUTCFullYear() + 1];
	return years.flatMap((y) => holidaysForYear(country, y)).filter((h) => h.date >= start && h.date <= end);
};
