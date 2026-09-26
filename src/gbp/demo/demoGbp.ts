import { Types } from 'mongoose';
import { DAILY_METRICS } from '../../clients/gbpClient';
import { PlaceDetails, PlaceDetailsResult } from '../../clients/types/places';
import { GBP_SYNC_TYPES, GbpKeywordMonthly, GbpMetricDaily, GbpProfileSnapshot, GbpReview, GbpSync, Location, UserGBP } from '../../models';
import { DEMO_PLACE_IDS } from '../../ranking/demo/demoPlaces';

// Offline demo GBP data (Phase 7c) for `npm run seed:gbp-demo` and the report tests. Deterministic:
// the same `now` always gives the same data. Sample data only; never used for live locations.

const DAY_MS = 86_400_000;

/** Small deterministic pseudo-random generator (mulberry32). */
const rng = (seed: number) => {
	let a = seed >>> 0;
	return (): number => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
};

const hash = (text: string): number => [...text].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

/** Daily base per metric; impressions grow ~25 % over 18 months, with a weekday pattern. */
const METRIC_BASE: Record<(typeof DAILY_METRICS)[number], number> = {
	BUSINESS_IMPRESSIONS_DESKTOP_MAPS: 18,
	BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: 30,
	BUSINESS_IMPRESSIONS_MOBILE_MAPS: 95,
	BUSINESS_IMPRESSIONS_MOBILE_SEARCH: 60,
	CALL_CLICKS: 3,
	WEBSITE_CLICKS: 4,
	BUSINESS_DIRECTION_REQUESTS: 2,
	BUSINESS_CONVERSATIONS: 0.3,
	BUSINESS_BOOKINGS: 0.2,
	BUSINESS_FOOD_ORDERS: 0,
	BUSINESS_FOOD_MENU_CLICKS: 0,
};

/** 18 months of daily metrics ending 3 days before `now` (Google's lag), with a few missing days. */
export const demoMetricRows = (locationId: Types.ObjectId, now: Date, months = 18) => {
	const random = rng(42);
	const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 3 * DAY_MS);
	const days = Math.round(months * 30.4);
	const rows: { location_id: Types.ObjectId; date: string; metric: string; value: number }[] = [];
	for (let i = days - 1; i >= 0; i -= 1) {
		const date = new Date(end.getTime() - i * DAY_MS);
		if (i % 97 === 50) continue; // a gap now and then, like real data
		const growth = 1 + 0.25 * ((days - i) / days);
		const weekday = [0.7, 1.1, 1.1, 1.05, 1.05, 1, 0.8][date.getUTCDay()];
		for (const metric of DAILY_METRICS) {
			const base = METRIC_BASE[metric];
			if (base === 0) continue;
			const value = Math.max(0, Math.round(base * growth * weekday * (0.8 + random() * 0.4)));
			rows.push({ location_id: locationId, date: isoDate(date), metric, value });
		}
	}
	return rows;
};

const KEYWORDS: { keyword: string; base: number | null; threshold?: number }[] = [
	{ keyword: 'plumber near me', base: 420 },
	{ keyword: 'emergency plumber', base: 180 },
	{ keyword: 'maple leaf plumbing', base: 150 },
	{ keyword: 'plumber toronto', base: 95 },
	{ keyword: 'drain cleaning', base: 60 },
	{ keyword: 'water heater repair', base: 35 },
	{ keyword: 'sump pump installation', base: null, threshold: 15 },
	{ keyword: 'toilet repair', base: null, threshold: 15 },
];

/** The last 6 complete months of search keywords, including "fewer than 15" thresholds. */
export const demoKeywordRows = (locationId: Types.ObjectId, now: Date, months = 6) => {
	const rows: { location_id: Types.ObjectId; month: string; keyword: string; value: number | null; threshold: number | null }[] = [];
	for (let m = months; m >= 1; m -= 1) {
		const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, 1));
		const month = d.toISOString().slice(0, 7);
		for (const [i, k] of KEYWORDS.entries()) {
			const value = k.base === null ? null : Math.round(k.base * (1 + ((months - m) * 0.04 * (i % 2 ? -1 : 1))));
			rows.push({ location_id: locationId, month, keyword: k.keyword, value, threshold: k.base === null ? (k.threshold ?? 15) : null });
		}
	}
	return rows;
};

/** US/CA holiday dates in the next 60 days are partly covered, so the score shows a fix. */
export const demoSnapshot = (locationId: Types.ObjectId, syncId: Types.ObjectId, now: Date) => ({
	location_id: locationId,
	sync_id: syncId,
	taken_at: now,
	is_latest: true,
	profile: {
		title: 'Maple Leaf Plumbing & Heating',
		description:
			'Family-owned plumbers serving Toronto since 1998. Emergency plumbing 24/7, drain cleaning, water heater repair and installation, sump pumps and bathroom renovations. Licensed, insured, upfront pricing.',
		primary_category: 'Plumber',
		additional_categories: ['Drainage service', 'Water heater installation service'],
		regular_hours: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'].map((day) => ({ open_day: day, open_time: '08:00', close_day: day, close_time: '18:00' })),
		special_hour_dates: [],
		more_hours_types: ['DELIVERY'],
		primary_phone: '(416) 555-0100',
		additional_phones: [],
		website: 'https://mapleleafplumbing.example',
		service_area: { business_type: 'CUSTOMER_AND_BUSINESS_LOCATION', place_count: 3, region_code: 'CA' },
		labels: [],
		open_status: 'OPEN',
		service_items: 7,
		latlng: { latitude: 43.6629, longitude: -79.3347 },
		place_id: DEMO_PLACE_IDS.self,
		maps_uri: null,
		new_review_uri: null,
	},
	raw_location: null,
	attributes: ['has_wheelchair_accessible_entrance', 'pay_credit_card', 'pay_debit_card', 'is_owned_by_family'].map((name) => ({ name: `attributes/${name}`, value_type: 'BOOL', values: [true] })),
	pending_google_edits: { has_pending: true, diff_fields: ['regularHours'], pending_fields: ['regularHours'] },
	verification: { has_voice_of_merchant: true, has_business_authority: true, state: 'VERIFIED', guidance: null },
	media: {
		owner_count: 14,
		customer_count: 22,
		latest_owner_upload: new Date(now.getTime() - 41 * DAY_MS),
		owner_uploads_per_month: { [new Date(now.getTime() - 41 * DAY_MS).toISOString().slice(0, 7)]: 3 },
	},
	posts: {
		total: 9,
		last_post_at: new Date(now.getTime() - 12 * DAY_MS),
		last_30_days: 2,
		last_90_days: 5,
		per_month: { [new Date(now.getTime() - 12 * DAY_MS).toISOString().slice(0, 7)]: 2 },
	},
	reviews_summary: { average_rating: 4.6, total: 64 },
});

const REVIEW_TEXTS = [
	'Came out within the hour for a burst pipe. Fair price.',
	'Great job on our water heater, very tidy.',
	'Drain cleared quickly, would call again.',
	'Showed up late but the work was good.',
	'Friendly and professional, explained everything.',
	'Too expensive for a simple fix.',
];

/** About 60 reviews over two years; recent ones are partly unreplied. */
export const demoReviews = (locationId: Types.ObjectId, now: Date, count = 60) => {
	const random = rng(7);
	return Array.from({ length: count }, (_, i) => {
		const created = new Date(now.getTime() - Math.round((i * 12 + random() * 10) * DAY_MS));
		const rating = random() < 0.08 ? 2 : random() < 0.2 ? 4 : 5;
		const replied = i >= 3 && random() < 0.8;
		return {
			location_id: locationId,
			review_name: `accounts/demo/locations/demo/reviews/demo-${i}`,
			rating,
			comment: REVIEW_TEXTS[i % REVIEW_TEXTS.length],
			create_time: created,
			update_time: created,
			reply: replied ? { comment: 'Thank you for choosing Maple Leaf!', update_time: new Date(created.getTime() + (6 + random() * 60) * 3_600_000) } : null,
			reviewer: { display_name: `Customer ${i + 1}`, is_anonymous: i % 9 === 0 },
			synced_at: now,
		};
	});
};

const KNOWN_DETAILS: Record<string, PlaceDetails> = {
	[DEMO_PLACE_IDS.self]: {
		displayName: 'Maple Leaf Plumbing & Heating',
		rating: 4.6,
		userRatingCount: 64,
		primaryType: 'plumber',
		primaryTypeDisplayName: 'Plumber',
		regularOpeningHours: { weekdayDescriptions: ['Monday: 8:00 AM – 6:00 PM'] },
		websiteUri: 'https://mapleleafplumbing.example',
		nationalPhoneNumber: '(416) 555-0100',
		businessStatus: 'OPERATIONAL',
	},
	[DEMO_PLACE_IDS.competitor_1]: {
		displayName: 'Queen West Plumbing Co.',
		rating: 4.8,
		userRatingCount: 212,
		primaryType: 'plumber',
		primaryTypeDisplayName: 'Plumber',
		regularOpeningHours: { weekdayDescriptions: ['Monday: Open 24 hours'] },
		websiteUri: 'https://queenwest.example',
		nationalPhoneNumber: '(416) 555-0111',
		businessStatus: 'OPERATIONAL',
	},
	[DEMO_PLACE_IDS.competitor_2]: {
		displayName: 'Danforth Drain Pros',
		rating: 4.3,
		userRatingCount: 38,
		primaryType: 'plumber',
		primaryTypeDisplayName: 'Plumber',
		websiteUri: 'https://danforthdrain.example',
		nationalPhoneNumber: '(416) 555-0122',
		businessStatus: 'OPERATIONAL',
	},
};

/** Offline Place Details: known demo businesses, and deterministic facts for any other place ID. */
export const createDemoDetailsClient = () => {
	let calls = 0;
	return {
		getPlaceDetails: async (placeId: string): Promise<PlaceDetailsResult> => {
			calls += 1;
			const known = KNOWN_DETAILS[placeId];
			if (known) return { details: { id: placeId, ...known }, apiCalls: 1 };
			const random = rng(hash(placeId));
			return {
				details: {
					id: placeId,
					displayName: `Toronto Plumbing ${placeId.slice(-4)}`,
					rating: Math.round((3.8 + random() * 1.1) * 10) / 10,
					userRatingCount: Math.round(5 + random() * 180),
					primaryType: random() < 0.8 ? 'plumber' : 'drainage_service',
					primaryTypeDisplayName: 'Plumber',
					regularOpeningHours: random() < 0.85 ? { weekdayDescriptions: ['Monday: 9:00 AM – 5:00 PM'] } : undefined,
					websiteUri: random() < 0.7 ? 'https://example.test' : undefined,
					nationalPhoneNumber: '(416) 555-0199',
					businessStatus: 'OPERATIONAL',
				},
				apiCalls: 1,
			};
		},
		calls: () => calls,
	};
};

/**
 * Writes a complete demo GBP data set for a location: a binding, a finished sync, 18 months of
 * metrics, 6 months of keywords, a snapshot (with v4 media/posts/review summary) and reviews.
 */
export const writeDemoGbpData = async (location: { _id: Types.ObjectId; created_by?: unknown }, userId: Types.ObjectId, now: Date): Promise<void> => {
	const locationId = location._id;
	await UserGBP.create({
		user_id: userId,
		location_id: locationId,
		gbpAccountId: 'accounts/demo',
		gbpLocationId: 'locations/demo',
		google_sub: 'demo-google-sub',
		place_id: DEMO_PLACE_IDS.self,
	});
	const sync = await GbpSync.create({
		location_id: locationId,
		created_by: userId,
		google_sub: 'demo-google-sub',
		gbp_location_id: 'locations/demo',
		gbp_account_id: 'accounts/demo',
		trigger: 'onboarding',
		status: 'done',
		active: false,
		run_at: new Date(now.getTime() - 5 * 60_000),
		started_at: new Date(now.getTime() - 5 * 60_000),
		finished_at: new Date(now.getTime() - 4 * 60_000),
		duration_ms: 60_000,
		backfill: true,
		types: Object.fromEntries(GBP_SYNC_TYPES.map((t) => [t, { status: 'ok', message: null, rows: 0, range: null }])),
		api_calls: { total: 14, by_endpoint: {} },
	});
	await GbpMetricDaily.insertMany(demoMetricRows(locationId, now));
	await GbpKeywordMonthly.insertMany(demoKeywordRows(locationId, now));
	await GbpProfileSnapshot.create(demoSnapshot(locationId, sync._id as Types.ObjectId, now));
	await GbpReview.insertMany(demoReviews(locationId, now));
	await Location.updateOne(
		{ _id: locationId },
		{ $set: { 'gbp_sync.last_synced_at': sync.finished_at, 'gbp_sync.last_status': 'done', 'gbp_sync.last_sync_id': String(sync._id), 'gbp_sync.backfilled_at': now } },
	);
};
