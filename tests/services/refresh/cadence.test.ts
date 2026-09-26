import { anchorDayFrom, initialSchedule, nextRefreshAt, normaliseFrequency, zoneFor } from '../../../src/services/refresh/cadence';

describe('monthly refresh cadence', () => {
	it('anchor day is the setup day of month, clamped to 28', () => {
		expect(anchorDayFrom(new Date('2026-09-12T15:00:00Z'))).toBe(12);
		expect(anchorDayFrom(new Date('2026-08-31T15:00:00Z'))).toBe(28);
		expect(anchorDayFrom(new Date('2026-09-01T02:00:00Z'), 'America/Chicago')).toBe(28); // still Aug 31 in Chicago → clamped
	});

	it('zone: IANA when valid, else an offset from longitude, else UTC', () => {
		expect(zoneFor({ timezone: 'America/Moncton', lng: -66.6 })).toBe('America/Moncton');
		expect(zoneFor({ timezone: 'Not/AZone', lng: -66.6 })).toBe('UTC-4'); // Fredericton ≈ −4.4 h
		expect(zoneFor({ lng: -96.8 })).toBe('UTC-6'); // Dallas
		expect(zoneFor({ lng: 2 })).toBe('UTC');
		expect(zoneFor({})).toBe('UTC');
	});

	it('next refresh: the anchor day at 03:00 local, this month if still ahead, else next month', () => {
		const zone = 'UTC-6';
		expect(nextRefreshAt(12, zone, new Date('2026-09-10T00:00:00Z'), 3).toISOString()).toBe('2026-09-12T09:00:00.000Z');
		expect(nextRefreshAt(12, zone, new Date('2026-09-12T09:00:00Z'), 3).toISOString()).toBe('2026-10-12T09:00:00.000Z');
		expect(nextRefreshAt(28, zone, new Date('2026-12-30T00:00:00Z'), 3).toISOString()).toBe('2027-01-28T09:00:00.000Z');
		expect(nextRefreshAt(28, 'UTC', new Date('2027-02-01T00:00:00Z'), 3).toISOString()).toBe('2027-02-28T03:00:00.000Z');
	});

	it('uses the IANA zone across daylight saving (03:00 local both times)', () => {
		const summer = nextRefreshAt(5, 'America/Chicago', new Date('2026-07-01T00:00:00Z'), 3);
		const winter = nextRefreshAt(5, 'America/Chicago', new Date('2026-12-01T00:00:00Z'), 3);
		expect(summer.toISOString()).toBe('2026-07-05T08:00:00.000Z'); // CDT, UTC-5
		expect(winter.toISOString()).toBe('2026-12-05T09:00:00.000Z'); // CST, UTC-6
	});

	it('no catch-up burst: after a long outage the next date is simply the next anchor date', () => {
		expect(nextRefreshAt(12, 'UTC', new Date('2027-03-20T00:00:00Z'), 3).toISOString()).toBe('2027-04-12T03:00:00.000Z');
	});

	it('initial schedule: anchor = setup day; first automatic refresh next month', () => {
		const s = initialSchedule({ lng: -96.8 }, new Date('2026-09-26T07:00:00Z'), 3); // 01:00 in UTC-6, before 03:00
		expect(s.anchor_day).toBe(26);
		expect(s.next_refresh_at.toISOString()).toBe('2026-10-26T09:00:00.000Z');
	});

	it('maps pre-7b frequencies', () => {
		expect(normaliseFrequency('weekly')).toBe('auto_monthly');
		expect(normaliseFrequency('monthly')).toBe('auto_monthly');
		expect(normaliseFrequency('manual')).toBe('manual_only');
		expect(normaliseFrequency('manual_only')).toBe('manual_only');
		expect(normaliseFrequency(undefined)).toBe('auto_monthly');
	});
});
