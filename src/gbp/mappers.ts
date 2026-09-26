import { Types } from 'mongoose';
import {
	GoogleDate,
	RawAttributes,
	RawDailyMetricsResponse,
	RawGoogleUpdated,
	RawLocalPost,
	RawMediaItem,
	RawReview,
	RawSearchKeywordsPage,
	RawVoiceOfMerchantState,
} from '../clients/types/gbp';
import { GbpHoursPeriod, GbpProfileSummary, IGbpProfileSnapshot } from '../models/gbpData.model';

// Pure mappers from GBP API responses to stored shapes (Phase 7b). Raw responses stop here.

const DAY_MS = 24 * 60 * 60 * 1000;

const isoDate = (d: GoogleDate | undefined): string | null =>
	d?.year && d.month && d.day ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}` : null;

const toNumber = (value: string | number | undefined | null): number | null => {
	if (value === undefined || value === null || value === '') return null;
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
};

const toDate = (value: string | undefined | null): Date | null => {
	if (!value) return null;
	const d = new Date(value);
	return Number.isNaN(d.getTime()) ? null : d;
};

const monthKey = (d: Date): string => d.toISOString().slice(0, 7);

// ---- performance ----

export interface DailyMetricRow {
	date: string;
	metric: string;
	value: number;
}

/**
 * One row per (metric, date). Google omits `value` on days with zero, but still lists the date;
 * those become 0. Days Google does not list at all are left out (no data yet).
 */
export const mapDailyMetrics = (raw: RawDailyMetricsResponse): DailyMetricRow[] => {
	const rows: DailyMetricRow[] = [];
	for (const group of raw.multiDailyMetricTimeSeries ?? []) {
		for (const series of group.dailyMetricTimeSeries ?? []) {
			if (!series.dailyMetric) continue;
			for (const dated of series.timeSeries?.datedValues ?? []) {
				const date = isoDate(dated.date);
				if (!date) continue;
				rows.push({ date, metric: series.dailyMetric, value: toNumber(dated.value) ?? 0 });
			}
		}
	}
	return rows;
};

// ---- search keywords ----

export interface KeywordRow {
	keyword: string;
	value: number | null;
	threshold: number | null;
}

/** Exact values stay values; "fewer than N" stays a threshold (never coerced into a value). */
export const mapKeywords = (items: NonNullable<RawSearchKeywordsPage['searchKeywordsCounts']>): KeywordRow[] =>
	items
		.filter((i) => i.searchKeyword)
		.map((i) => ({
			keyword: String(i.searchKeyword).trim(),
			value: toNumber(i.insightsValue?.value),
			threshold: i.insightsValue?.value !== undefined ? null : toNumber(i.insightsValue?.threshold),
		}));

// ---- profile ----

interface RawTimePeriod {
	openDay?: string;
	openTime?: { hours?: number; minutes?: number };
	closeDay?: string;
	closeTime?: { hours?: number; minutes?: number };
}

const hhmm = (t: { hours?: number; minutes?: number } | undefined): string | null =>
	t ? `${String(t.hours ?? 0).padStart(2, '0')}:${String(t.minutes ?? 0).padStart(2, '0')}` : null;

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === 'object' ? (v as Raw) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

export const mapProfile = (raw: Raw): GbpProfileSummary => {
	const categories = obj(raw.categories);
	const phones = obj(raw.phoneNumbers);
	const serviceArea = obj(raw.serviceArea);
	const metadata = obj(raw.metadata);
	const latlng = obj(raw.latlng);
	const periods = arr(obj(raw.regularHours).periods) as RawTimePeriod[];
	const special = arr(obj(raw.specialHours).specialHourPeriods).map((p) => isoDate(obj(p).startDate as GoogleDate)).filter((d): d is string => Boolean(d));
	const places = arr(obj(serviceArea.places).placeInfos);
	return {
		title: str(raw.title),
		description: str(obj(raw.profile).description),
		primary_category: str(obj(categories.primaryCategory).displayName),
		additional_categories: arr(categories.additionalCategories).map((c) => str(obj(c).displayName)).filter((c): c is string => Boolean(c)),
		regular_hours: periods.map(
			(p): GbpHoursPeriod => ({ open_day: p.openDay ?? null, open_time: hhmm(p.openTime), close_day: p.closeDay ?? null, close_time: hhmm(p.closeTime) }),
		),
		special_hour_dates: [...new Set(special)].sort(),
		more_hours_types: arr(raw.moreHours).map((m) => str(obj(m).hoursTypeId)).filter((m): m is string => Boolean(m)),
		primary_phone: str(phones.primaryPhone),
		additional_phones: arr(phones.additionalPhones).map(str).filter((p): p is string => Boolean(p)),
		website: str(raw.websiteUri),
		service_area: {
			business_type: str(serviceArea.businessType),
			place_count: places.length,
			region_code: str(serviceArea.regionCode),
		},
		labels: arr(raw.labels).map(str).filter((l): l is string => Boolean(l)),
		open_status: str(obj(raw.openInfo).status),
		service_items: arr(raw.serviceItems).length,
		latlng: typeof latlng.latitude === 'number' && typeof latlng.longitude === 'number' ? { latitude: latlng.latitude, longitude: latlng.longitude } : null,
		place_id: str(metadata.placeId),
		maps_uri: str(metadata.mapsUri),
		new_review_uri: str(metadata.newReviewUri),
	};
};

export const mapAttributes = (raw: RawAttributes): NonNullable<IGbpProfileSnapshot['attributes']> =>
	(raw.attributes ?? [])
		.filter((a) => a.name)
		.map((a) => ({
			name: String(a.name).replace(/^attributes\//, ''),
			value_type: a.valueType ?? null,
			values: a.values ?? a.repeatedEnumValue?.setValues ?? (a.uriValues ?? []).map((u) => u.uri),
		}));

const maskFields = (mask: string | undefined): string[] =>
	(mask ?? '')
		.split(',')
		.map((f) => f.trim())
		.filter(Boolean);

/** Google-side changes (diffMask) and edits under review (pendingMask). */
export const mapGoogleUpdated = (raw: RawGoogleUpdated): NonNullable<IGbpProfileSnapshot['pending_google_edits']> => {
	const diff = maskFields(raw.diffMask);
	const pending = maskFields(raw.pendingMask);
	return { has_pending: diff.length > 0 || pending.length > 0, diff_fields: diff, pending_fields: pending };
};

/** Verification: the one action Google asks for next (if any), and whether the owner has control. */
export const mapVerification = (raw: RawVoiceOfMerchantState): NonNullable<IGbpProfileSnapshot['verification']> => {
	const state = raw.verify
		? raw.verify.hasPendingVerification
			? 'verification_pending'
			: 'verification_required'
		: raw.waitForVoiceOfMerchant
			? 'waiting_for_voice_of_merchant'
			: raw.resolveOwnershipConflict
				? 'ownership_conflict'
				: raw.complyWithGuidelines
					? 'comply_with_guidelines'
					: raw.hasVoiceOfMerchant
						? 'verified'
						: null;
	return {
		has_voice_of_merchant: raw.hasVoiceOfMerchant === true,
		has_business_authority: raw.hasBusinessAuthority === true,
		state,
		guidance: raw.complyWithGuidelines?.recommendationReason ?? null,
	};
};

// ---- v4: reviews, media, posts ----

const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

export const mapReview = (raw: RawReview, locationId: Types.ObjectId, syncedAt: Date) =>
	raw.name
		? {
				location_id: locationId,
				review_name: raw.name,
				rating: raw.starRating ? (STARS[raw.starRating] ?? null) : null,
				comment: raw.comment ?? null,
				create_time: toDate(raw.createTime),
				update_time: toDate(raw.updateTime),
				reply: raw.reviewReply?.comment ? { comment: raw.reviewReply.comment, update_time: toDate(raw.reviewReply.updateTime) } : null,
				reviewer: { display_name: raw.reviewer?.displayName ?? null, is_anonymous: raw.reviewer?.isAnonymous === true },
				synced_at: syncedAt,
			}
		: null;

export const mapMediaSummary = (ownerItems: RawMediaItem[], ownerTotal: number, customerTotal: number): NonNullable<IGbpProfileSnapshot['media']> => {
	const created = ownerItems.map((m) => toDate(m.createTime)).filter((d): d is Date => d !== null);
	const perMonth: Record<string, number> = {};
	for (const d of created) perMonth[monthKey(d)] = (perMonth[monthKey(d)] ?? 0) + 1;
	return {
		owner_count: ownerTotal,
		customer_count: customerTotal,
		latest_owner_upload: created.length > 0 ? new Date(Math.max(...created.map((d) => d.getTime()))) : null,
		owner_uploads_per_month: perMonth,
	};
};

export const mapPostsSummary = (posts: RawLocalPost[], now: Date): NonNullable<IGbpProfileSnapshot['posts']> => {
	const created = posts.map((p) => toDate(p.createTime)).filter((d): d is Date => d !== null);
	const within = (days: number) => created.filter((d) => now.getTime() - d.getTime() <= days * DAY_MS).length;
	const perMonth: Record<string, number> = {};
	for (const d of created) perMonth[monthKey(d)] = (perMonth[monthKey(d)] ?? 0) + 1;
	return {
		total: posts.length,
		last_post_at: created.length > 0 ? new Date(Math.max(...created.map((d) => d.getTime()))) : null,
		last_30_days: within(30),
		last_90_days: within(90),
		per_month: perMonth,
	};
};
