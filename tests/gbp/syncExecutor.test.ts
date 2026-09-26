import { Agenda } from 'agenda';
import { Types } from 'mongoose';
import { GbpApiError, GbpReauthRequiredError } from '../../src/clients/gbpClient';
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
import { executeGbpSync } from '../../src/gbp/sync.executor';
import {
	GbpKeywordMonthly,
	GbpMetricDaily,
	GbpProfileSnapshot,
	GbpReview,
	GbpSync,
	ILocation,
	Location,
	UserGBP,
} from '../../src/models';
import { enqueueGbpSync } from '../../src/services/gbp/sync.service';
import { loadGbpFixture } from '../helpers/fakeTransport';
import { clearDb, createLocation, createUser, startTestDb } from '../helpers/mongoose';

jest.mock('../../src/configs/mongoConnection', () => ({ agenda: {} }));

const NOW = new Date('2026-09-26T09:00:00Z');
const settings = { backfillMonths: 18, rollingDays: 40, keywordBackfillMonths: 6, keywordRollingMonths: 2 };
const agenda = { schedule: jest.fn(async () => ({})) } as unknown as Agenda;

type Fail = Partial<Record<'performance' | 'keywords' | 'profile' | 'verification' | 'reviews' | 'media' | 'posts', Error>>;

/** A fake Google built from the fixtures; counts calls per method. */
const fakeClient = (fail: Fail = {}) => {
	const calls: Record<string, number> = {};
	const ranges: unknown[] = [];
	const count = (name: string) => {
		calls[name] = (calls[name] ?? 0) + 1;
	};
	const maybe = <T>(type: keyof Fail, value: T): T => {
		if (fail[type]) throw fail[type];
		return value;
	};
	const client = {
		fetchDailyMetrics: async (_c: unknown, _l: string, _m: readonly string[], range: unknown) => {
			count('performance');
			ranges.push(range);
			return maybe('performance', loadGbpFixture<RawDailyMetricsResponse>('perf_daily'));
		},
		listSearchKeywords: async () => {
			count('keywords');
			const items = [
				...(loadGbpFixture<RawSearchKeywordsPage>('keywords_p1').searchKeywordsCounts ?? []),
				...(loadGbpFixture<RawSearchKeywordsPage>('keywords_p2').searchKeywordsCounts ?? []),
			];
			return maybe('keywords', { items, pages: 2, truncated: false });
		},
		getLocationFull: async () => {
			count('profile');
			return maybe('profile', loadGbpFixture<Record<string, unknown>>('location_full'));
		},
		getAttributes: async () => {
			count('attributes');
			return loadGbpFixture<RawAttributes>('attributes');
		},
		getGoogleUpdated: async () => {
			count('googleUpdated');
			return loadGbpFixture<RawGoogleUpdated>('google_updated');
		},
		getVoiceOfMerchantState: async () => {
			count('verification');
			return maybe('verification', loadGbpFixture<RawVoiceOfMerchantState>('voice_of_merchant'));
		},
		listReviews: async () => {
			count('reviews');
			const items = [
				...(loadGbpFixture<RawReviewsPage>('reviews_p1').reviews ?? []),
				...(loadGbpFixture<RawReviewsPage>('reviews_p2').reviews ?? []),
			];
			return maybe('reviews', { items, pages: 2, truncated: false, first: null, averageRating: 4.6, totalReviewCount: 3 });
		},
		listMedia: async () => {
			count('media');
			const page = loadGbpFixture<RawMediaPage>('media');
			return maybe('media', { items: page.mediaItems ?? [], pages: 1, truncated: false, first: page, total: page.totalMediaItemCount ?? 0 });
		},
		countCustomerMedia: async () => {
			count('customerMedia');
			return 7;
		},
		listLocalPosts: async () => {
			count('posts');
			const page = loadGbpFixture<RawLocalPostsPage>('local_posts');
			return maybe('posts', { items: page.localPosts ?? [], pages: 1, truncated: false, first: page });
		},
		getStats: () => ({ calls: Object.values(calls).reduce((a, b) => a + b, 0), byEndpoint: { ...calls } }),
	};
	return { client, calls, ranges };
};

let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
	await Promise.all([
		GbpSync.syncIndexes(),
		GbpMetricDaily.syncIndexes(),
		GbpKeywordMonthly.syncIndexes(),
		GbpReview.syncIndexes(),
		UserGBP.syncIndexes(),
	]);
});
afterAll(async () => db.stop());
beforeEach(async () => clearDb());

const boundLocation = async () => {
	const { user } = await createUser(`g${Math.random()}@test.dev`);
	const location = await createLocation(user._id as Types.ObjectId);
	await UserGBP.create({
		user_id: user._id,
		location_id: location._id,
		gbpAccountId: 'accounts/100000000000000000001',
		gbpLocationId: 'locations/200000000000000000001',
		google_sub: 'sub-1',
	});
	return { user, location };
};

const queue = async (location: ILocation, userId: unknown) =>
	(await enqueueGbpSync(location, String(userId), 'manual', { agenda, now: NOW })).sync_id;

describe('gbp-sync executor', () => {
	it('first sync: backfill windows, every live type stored, v4 not_available with 0 calls', async () => {
		const { user, location } = await boundLocation();
		const syncId = await queue(location, user._id);
		const { client, calls, ranges } = fakeClient();
		const result = await executeGbpSync(syncId, { client, v4Enabled: false, settings, now: () => NOW });

		expect(result?.status).toBe('done');
		expect(result?.types).toMatchObject({
			performance: { status: 'ok', rows: 6, range: { from: '2025-03-26', to: '2026-09-25' } },
			keywords: { status: 'ok', rows: 24, range: { from: '2026-03', to: '2026-08' } }, // 6 months × 4 keywords
			profile: { status: 'ok' },
			verification: { status: 'ok' },
			reviews: { status: 'not_available', message: 'v4_access_pending' },
			media: { status: 'not_available' },
			posts: { status: 'not_available' },
		});
		expect(calls).toEqual({ performance: 1, keywords: 6, profile: 1, attributes: 1, googleUpdated: 1, verification: 1 });
		expect(ranges).toHaveLength(1);

		expect(await GbpMetricDaily.countDocuments({ location_id: location._id })).toBe(6);
		expect(await GbpKeywordMonthly.findOne({ location_id: location._id, month: '2026-08', keyword: 'example plumbing co' }).lean()).toMatchObject({
			value: null,
			threshold: 15,
		});
		const snapshot = await GbpProfileSnapshot.findOne({ location_id: location._id, is_latest: true }).lean();
		expect(snapshot).toMatchObject({
			profile: { title: 'Example Plumbing Co', primary_category: 'Plumber', service_items: 2 },
			pending_google_edits: { has_pending: true, diff_fields: ['title'] },
			verification: { has_voice_of_merchant: true, state: 'verified' },
			media: null,
			posts: null,
			reviews_summary: null,
		});
		expect(snapshot?.attributes).toHaveLength(3);
		expect(await GbpReview.countDocuments({})).toBe(0);

		const saved = await Location.findById(location._id).lean<ILocation>();
		expect(saved?.gbp_sync).toMatchObject({ last_status: 'done', last_sync_id: syncId });
		expect(saved?.gbp_sync?.backfilled_at).toBeInstanceOf(Date);
		expect(await GbpSync.findById(syncId).lean()).toMatchObject({ status: 'done', active: false, api_calls: { total: 11 } });
	});

	it('later syncs use the rolling windows; re-running upserts without duplicates; history of snapshots is kept', async () => {
		const { user, location } = await boundLocation();
		const first = fakeClient();
		await executeGbpSync(await queue(location, user._id), { client: first.client, v4Enabled: false, settings, now: () => NOW });
		const fresh = (await Location.findById(location._id)) as ILocation;
		const second = fakeClient();
		const result = await executeGbpSync(await queue(fresh, user._id), { client: second.client, v4Enabled: false, settings, now: () => NOW });
		expect(result?.types.performance.range).toEqual({ from: '2026-08-17', to: '2026-09-25' });
		expect(result?.types.keywords.range).toEqual({ from: '2026-07', to: '2026-08' });
		expect(second.calls.keywords).toBe(2);
		expect(await GbpMetricDaily.countDocuments({ location_id: location._id })).toBe(6);
		expect(await GbpProfileSnapshot.countDocuments({ location_id: location._id })).toBe(2);
		expect(await GbpProfileSnapshot.countDocuments({ location_id: location._id, is_latest: true })).toBe(1);
	});

	it('v4 enabled: reviews (display name only), media and posts are stored', async () => {
		const { user, location } = await boundLocation();
		const { client, calls } = fakeClient();
		const result = await executeGbpSync(await queue(location, user._id), { client, v4Enabled: true, settings, now: () => NOW });
		expect(result?.status).toBe('done');
		expect(calls).toMatchObject({ reviews: 1, media: 1, customerMedia: 1, posts: 1 });
		expect(await GbpReview.countDocuments({ location_id: location._id })).toBe(3);
		const review = await GbpReview.findOne({ review_name: /reviews\/r1$/ }).lean();
		expect(review).toMatchObject({ rating: 5, reply: { comment: 'Thanks Sam!' }, reviewer: { display_name: 'Sam K.' } });
		expect(JSON.stringify(review)).not.toContain('lh3.example');
		const snapshot = await GbpProfileSnapshot.findOne({ location_id: location._id, is_latest: true }).lean();
		expect(snapshot).toMatchObject({
			reviews_summary: { average_rating: 4.6, total: 3 },
			media: { owner_count: 2, customer_count: 7 },
			posts: { total: 2, last_30_days: 1 },
		});
	});

	it('one failing type → partial; the others are stored', async () => {
		const { user, location } = await boundLocation();
		const { client } = fakeClient({ keywords: new GbpApiError('GBP performance.searchKeywords failed: backend error', { status: 500 }, 2) });
		const result = await executeGbpSync(await queue(location, user._id), { client, v4Enabled: false, settings, now: () => NOW });
		expect(result?.status).toBe('partial');
		expect(result?.types.keywords).toMatchObject({ status: 'error' });
		expect(result?.types.performance.status).toBe('ok');
		expect(result?.types.profile.status).toBe('ok');
	});

	it('a connection-wide failure stops further calls and marks the rest as errors', async () => {
		const { user, location } = await boundLocation();
		const { client, calls } = fakeClient({ performance: new GbpReauthRequiredError(1) });
		const result = await executeGbpSync(await queue(location, user._id), { client, v4Enabled: true, settings, now: () => NOW });
		expect(result?.status).toBe('failed');
		expect(calls).toEqual({ performance: 1 });
		for (const t of ['keywords', 'profile', 'verification', 'reviews', 'media', 'posts'] as const) {
			expect(result?.types[t]).toMatchObject({ status: 'error', message: expect.stringMatching(/^Reconnect needed/) });
		}
		expect((await Location.findById(location._id).lean<ILocation>())?.gbp_sync?.backfilled_at ?? null).toBeNull();
	});

	it('one active sync per location; a finished sync is not run twice', async () => {
		const { user, location } = await boundLocation();
		const a = await enqueueGbpSync(location, String(user._id), 'manual', { agenda, now: NOW });
		const b = await enqueueGbpSync(location, String(user._id), 'scheduled', { agenda, now: NOW });
		expect(b).toMatchObject({ sync_id: a.sync_id, existing: true });
		expect(a.estimated_calls).toBe(1 + 6 + 4 + 1); // backfill: 6 keyword months
		const { client } = fakeClient();
		await executeGbpSync(a.sync_id, { client, v4Enabled: false, settings, now: () => NOW });
		expect(await executeGbpSync(a.sync_id, { client, v4Enabled: false, settings, now: () => NOW })).toBeNull();
	});

	it('refuses to queue for an unbound location, and fails cleanly if the binding disappears', async () => {
		const { user } = await createUser('u@test.dev');
		const unbound = await createLocation(user._id as Types.ObjectId);
		await expect(enqueueGbpSync(unbound, String(user._id), 'manual', { agenda, now: NOW })).rejects.toMatchObject({ statusCode: 400 });

		const bound = await boundLocation();
		const syncId = await queue(bound.location, bound.user._id);
		await UserGBP.deleteMany({ location_id: bound.location._id });
		const { client, calls } = fakeClient();
		const result = await executeGbpSync(syncId, { client, v4Enabled: false, settings, now: () => NOW });
		expect(result?.status).toBe('failed');
		expect(calls).toEqual({});
	});
});
