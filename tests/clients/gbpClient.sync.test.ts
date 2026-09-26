import { DAILY_METRICS, PROFILE_READ_MASK, createGbpClient } from '../../src/clients/gbpClient';
import { StoredTokens } from '../../src/services/gbp/tokenStore';
import { FakeStep, createFakeTransport } from '../helpers/fakeTransport';

const CONN = { userId: 'user-1', googleSub: 'sub-1' };
const LOC = 'locations/200000000000000000001';
const ACC = 'accounts/100000000000000000001';

const setup = (steps: FakeStep[]) => {
	const fake = createFakeTransport(steps);
	const stored: StoredTokens = {
		accessToken: 'ya29.FAKE',
		refreshToken: '1//FAKE',
		expiryDate: new Date(Date.now() + 3600_000),
		scope: null,
		status: 'active',
		googleEmail: null,
		googleSub: 'sub-1',
	};
	const client = createGbpClient({
		transport: fake.transport,
		tokens: { load: async () => stored, saveRefreshed: async () => undefined, markRevoked: async () => undefined },
		clientId: 'id',
		clientSecret: 'secret',
		redirectUri: 'http://localhost/cb',
		sleep: async () => undefined,
	});
	return { client, fake };
};

describe('gbpClient sync reads', () => {
	it('daily metrics: every metric and the inclusive date range as query params', async () => {
		const { client, fake } = setup([{ status: 200, fixture: 'gbp/perf_daily' }]);
		await client.fetchDailyMetrics(CONN, LOC, DAILY_METRICS, { start: { year: 2025, month: 3, day: 26 }, end: { year: 2026, month: 9, day: 25 } });
		const url = new URL(fake.requests[0].url);
		expect(url.origin + url.pathname).toBe(`https://businessprofileperformance.googleapis.com/v1/${LOC}:fetchMultiDailyMetricsTimeSeries`);
		expect(url.searchParams.getAll('dailyMetrics')).toEqual([...DAILY_METRICS]);
		expect(Object.fromEntries([...url.searchParams].filter(([k]) => k.startsWith('dailyRange')))).toEqual({
			'dailyRange.startDate.year': '2025',
			'dailyRange.startDate.month': '3',
			'dailyRange.startDate.day': '26',
			'dailyRange.endDate.year': '2026',
			'dailyRange.endDate.month': '9',
			'dailyRange.endDate.day': '25',
		});
	});

	it('search keywords: one month per request, all pages', async () => {
		const { client, fake } = setup([
			{ status: 200, fixture: 'gbp/keywords_p1' },
			{ status: 200, fixture: 'gbp/keywords_p2' },
		]);
		const result = await client.listSearchKeywords(CONN, LOC, { year: 2026, month: 8 });
		expect(result).toMatchObject({ pages: 2, truncated: false });
		expect(result.items).toHaveLength(4);
		const first = new URL(fake.requests[0].url);
		expect(first.pathname).toBe(`/v1/${LOC}/searchkeywords/impressions/monthly`);
		expect(first.searchParams.get('monthlyRange.startMonth.month')).toBe('8');
		expect(first.searchParams.get('monthlyRange.endMonth.month')).toBe('8');
		expect(new URL(fake.requests[1].url).searchParams.get('pageToken')).toBe('kw-page-2');
	});

	it('profile, attributes, Google edits and verification URLs', async () => {
		const { client, fake } = setup([
			{ status: 200, fixture: 'gbp/location_full' },
			{ status: 200, fixture: 'gbp/attributes' },
			{ status: 200, fixture: 'gbp/google_updated' },
			{ status: 200, fixture: 'gbp/voice_of_merchant' },
		]);
		await client.getLocationFull(CONN, LOC);
		await client.getAttributes(CONN, LOC);
		await client.getGoogleUpdated(CONN, LOC);
		await client.getVoiceOfMerchantState(CONN, LOC);
		const urls = fake.requests.map((r) => new URL(r.url));
		expect(urls[0].searchParams.get('readMask')).toBe(PROFILE_READ_MASK);
		expect(urls[1].pathname).toBe(`/v1/${LOC}/attributes`);
		expect(urls[2].pathname).toBe(`/v1/${LOC}:getGoogleUpdated`);
		expect(urls[3].origin + urls[3].pathname).toBe(`https://mybusinessverifications.googleapis.com/v1/${LOC}/VoiceOfMerchantState`);
	});

	it('v4 lists use accounts/A/locations/L and paginate', async () => {
		const { client, fake } = setup([
			{ status: 200, fixture: 'gbp/reviews_p1' },
			{ status: 200, fixture: 'gbp/reviews_p2' },
			{ status: 200, fixture: 'gbp/media' },
			{ status: 200, fixture: 'gbp/customer_media' },
			{ status: 200, fixture: 'gbp/local_posts' },
		]);
		const reviews = await client.listReviews(CONN, ACC, LOC);
		expect(reviews).toMatchObject({ pages: 2, averageRating: 4.6, totalReviewCount: 3 });
		expect(reviews.items).toHaveLength(3);
		expect((await client.listMedia(CONN, ACC, LOC)).total).toBe(2);
		expect(await client.countCustomerMedia(CONN, ACC, LOC)).toBe(7);
		expect((await client.listLocalPosts(CONN, ACC, LOC)).items).toHaveLength(2);
		const paths = fake.requests.map((r) => new URL(r.url).pathname);
		expect(paths).toEqual([
			`/v4/${ACC}/${LOC}/reviews`,
			`/v4/${ACC}/${LOC}/reviews`,
			`/v4/${ACC}/${LOC}/media`,
			`/v4/${ACC}/${LOC}/media/customers`,
			`/v4/${ACC}/${LOC}/localPosts`,
		]);
		expect(new URL(fake.requests[1].url).searchParams.get('pageToken')).toBe('rev-page-2');
	});
});
