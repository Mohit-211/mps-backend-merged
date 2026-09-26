import { Types } from 'mongoose';
import {
	RawAttributes,
	RawDailyMetricsResponse,
	RawGoogleUpdated,
	RawLocalPostsPage,
	RawMediaPage,
	RawReviewsPage,
	RawSearchKeywordsPage,
	RawVoiceOfMerchantState,
} from '../../src/clients/types/gbp';
import {
	mapAttributes,
	mapDailyMetrics,
	mapGoogleUpdated,
	mapKeywords,
	mapMediaSummary,
	mapPostsSummary,
	mapProfile,
	mapReview,
	mapVerification,
} from '../../src/gbp/mappers';
import { loadGbpFixture } from '../helpers/fakeTransport';

describe('GBP mappers', () => {
	it('daily metrics: one row per metric and date; a listed date without a value is 0', () => {
		const rows = mapDailyMetrics(loadGbpFixture<RawDailyMetricsResponse>('perf_daily'));
		expect(rows).toEqual([
			{ date: '2026-09-23', metric: 'BUSINESS_IMPRESSIONS_MOBILE_MAPS', value: 41 },
			{ date: '2026-09-24', metric: 'BUSINESS_IMPRESSIONS_MOBILE_MAPS', value: 0 },
			{ date: '2026-09-25', metric: 'BUSINESS_IMPRESSIONS_MOBILE_MAPS', value: 57 },
			{ date: '2026-09-23', metric: 'CALL_CLICKS', value: 2 },
			{ date: '2026-09-24', metric: 'CALL_CLICKS', value: 1 },
			{ date: '2026-09-25', metric: 'CALL_CLICKS', value: 0 },
		]);
	});

	it('keywords: exact values stay values, thresholds stay thresholds', () => {
		const items = [
			...(loadGbpFixture<RawSearchKeywordsPage>('keywords_p1').searchKeywordsCounts ?? []),
			...(loadGbpFixture<RawSearchKeywordsPage>('keywords_p2').searchKeywordsCounts ?? []),
		];
		expect(mapKeywords(items)).toEqual([
			{ keyword: 'plumber near me', value: 312, threshold: null },
			{ keyword: 'emergency plumber', value: 87, threshold: null },
			{ keyword: 'example plumbing co', value: null, threshold: 15 },
			{ keyword: 'drain cleaning dallas', value: null, threshold: 15 },
		]);
	});

	it('profile summary', () => {
		const profile = mapProfile(loadGbpFixture<Record<string, unknown>>('location_full'));
		expect(profile).toMatchObject({
			title: 'Example Plumbing Co',
			primary_category: 'Plumber',
			additional_categories: ['Drainage service'],
			primary_phone: '(214) 555-0100',
			additional_phones: ['(214) 555-0101'],
			website: 'https://example-plumbing.test/',
			special_hour_dates: ['2026-12-25', '2027-01-01'],
			more_hours_types: ['DRIVE_THROUGH'],
			service_area: { business_type: 'CUSTOMER_AND_BUSINESS_LOCATION', place_count: 2, region_code: 'US' },
			labels: ['dallas'],
			open_status: 'OPEN',
			service_items: 2,
			latlng: { latitude: 32.7801, longitude: -96.8005 },
			place_id: 'ChIJfakeGbpPlace000000001',
		});
		expect(profile.description?.length).toBeGreaterThan(50);
		expect(profile.regular_hours[1]).toEqual({ open_day: 'TUESDAY', open_time: '08:30', close_day: 'TUESDAY', close_time: '18:00' });
		expect(mapProfile({})).toMatchObject({ title: null, regular_hours: [], additional_categories: [], latlng: null });
	});

	it('attributes: bool, enum and URL values', () => {
		expect(mapAttributes(loadGbpFixture<RawAttributes>('attributes'))).toEqual([
			{ name: 'has_wheelchair_accessible_entrance', value_type: 'BOOL', values: [true] },
			{ name: 'pay_credit_card_types_accepted', value_type: 'REPEATED_ENUM', values: ['visa', 'mastercard'] },
			{ name: 'url_appointment', value_type: 'URL', values: ['https://example-plumbing.test/book'] },
		]);
	});

	it('pending Google edits from diffMask / pendingMask', () => {
		expect(mapGoogleUpdated(loadGbpFixture<RawGoogleUpdated>('google_updated'))).toEqual({
			has_pending: true,
			diff_fields: ['title'],
			pending_fields: ['profile.description'],
		});
		expect(mapGoogleUpdated({})).toEqual({ has_pending: false, diff_fields: [], pending_fields: [] });
	});

	it('verification state', () => {
		expect(mapVerification(loadGbpFixture<RawVoiceOfMerchantState>('voice_of_merchant'))).toEqual({
			has_voice_of_merchant: true,
			has_business_authority: true,
			state: 'verified',
			guidance: null,
		});
		expect(mapVerification({ hasVoiceOfMerchant: false, verify: { hasPendingVerification: true } }).state).toBe('verification_pending');
		expect(mapVerification({ complyWithGuidelines: { recommendationReason: 'BUSINESS_LOCATION_SUSPENDED' } })).toMatchObject({
			state: 'comply_with_guidelines',
			guidance: 'BUSINESS_LOCATION_SUSPENDED',
		});
	});

	it('reviews: stars → numbers, reply kept, reviewer display name only', () => {
		const at = new Date('2026-09-26T00:00:00Z');
		const locationId = new Types.ObjectId();
		const [r1, r2] = (loadGbpFixture<RawReviewsPage>('reviews_p1').reviews ?? []).map((r) => mapReview(r, locationId, at));
		expect(r1).toMatchObject({
			rating: 5,
			comment: 'Fast and fair.',
			reply: { comment: 'Thanks Sam!' },
			reviewer: { display_name: 'Sam K.', is_anonymous: false },
		});
		expect(JSON.stringify(r1)).not.toContain('lh3.example'); // no reviewer photo URL
		expect(r2).toMatchObject({ rating: 2, comment: null, reply: null, reviewer: { is_anonymous: true } });
	});

	it('media and posts summaries', () => {
		const media = loadGbpFixture<RawMediaPage>('media');
		expect(mapMediaSummary(media.mediaItems ?? [], media.totalMediaItemCount ?? 0, 7)).toEqual({
			owner_count: 2,
			customer_count: 7,
			latest_owner_upload: new Date('2026-09-10T10:00:00Z'),
			owner_uploads_per_month: { '2026-09': 1, '2026-08': 1 },
		});
		const posts = loadGbpFixture<RawLocalPostsPage>('local_posts').localPosts ?? [];
		expect(mapPostsSummary(posts, new Date('2026-09-26T00:00:00Z'))).toEqual({
			total: 2,
			last_post_at: new Date('2026-09-20T12:00:00Z'),
			last_30_days: 1,
			last_90_days: 2,
			per_month: { '2026-09': 1, '2026-07': 1 },
		});
	});
});
