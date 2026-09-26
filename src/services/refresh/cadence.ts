import { DateTime } from 'luxon';
import config from '../../configs/config';

// Monthly refresh cadence (Mohit, 2026-09-26), pure and unit-tested.
// Each location refreshes once a month on its anchor day (the day of the month it completed setup,
// clamped to 28 so every month has it) at about REFRESH_LOCAL_HOUR (03:00) local time. Dates are
// recomputed from the anchor each time: no drift, and no catch-up burst after an outage.
//
// Local time: the location's IANA timezone when set; otherwise an offset estimated from its
// longitude (15° per hour; about ±1 h, enough for "about 03:00"); otherwise UTC.

export const MAX_ANCHOR_DAY = 28;

/** Day of month (1–28) for an anchor date, in the given zone. */
export const anchorDayFrom = (date: Date, zone = 'UTC'): number =>
	Math.min(DateTime.fromJSDate(date, { zone }).day, MAX_ANCHOR_DAY);

/** A luxon zone for a location: its IANA timezone, else a fixed offset from longitude, else UTC. */
export const zoneFor = (location: { timezone?: string | null; lng?: number | null }): string => {
	if (location.timezone && DateTime.now().setZone(location.timezone).isValid) return location.timezone;
	if (typeof location.lng === 'number' && Number.isFinite(location.lng)) {
		const hours = Math.max(-12, Math.min(14, Math.round(location.lng / 15)));
		if (hours === 0) return 'UTC';
		return `UTC${hours > 0 ? '+' : ''}${hours}`;
	}
	return 'UTC';
};

/**
 * The first refresh moment strictly after `after`: the anchor day at `hour`:00 local time, this month
 * if still ahead, otherwise next month.
 */
export const nextRefreshAt = (anchorDay: number, zone: string, after: Date, hour: number = config.refresh.localHour): Date => {
	const day = Math.min(Math.max(1, Math.trunc(anchorDay)), MAX_ANCHOR_DAY);
	const local = DateTime.fromJSDate(after, { zone });
	let candidate = local.set({ day, hour, minute: 0, second: 0, millisecond: 0 });
	if (candidate.toMillis() <= after.getTime()) candidate = candidate.plus({ months: 1 }).set({ day });
	return candidate.toJSDate();
};

/**
 * Schedule for a location that just completed setup at `completedAt`: its anchor day and the first
 * automatic refresh (next month: the setup itself already queued the first run).
 */
export const initialSchedule = (
	location: { timezone?: string | null; lng?: number | null },
	completedAt: Date,
	hour: number = config.refresh.localHour,
): { anchor_day: number; next_refresh_at: Date } => {
	const zone = zoneFor(location);
	const anchor = anchorDayFrom(completedAt, zone);
	// Skip the rest of today so a setup finished before 03:00 isn't refreshed again a few hours later.
	const after = DateTime.fromJSDate(completedAt, { zone }).plus({ days: 1 }).toJSDate();
	return { anchor_day: anchor, next_refresh_at: nextRefreshAt(anchor, zone, after, hour) };
};

/** Maps a stored frequency, including pre-7b values, to the current ones. */
export const normaliseFrequency = (value: string | null | undefined): 'auto_monthly' | 'manual_only' =>
	value === 'manual' || value === 'manual_only' ? 'manual_only' : 'auto_monthly';
