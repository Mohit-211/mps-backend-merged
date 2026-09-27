import { Types } from 'mongoose';
import { createPlacesClient } from '../../../src/clients/placesClient';
import { createMongoLimiter } from '../../../src/clients/placesRateLimiter';
import { DEFAULT_PRICING, loadPricing } from '../../../src/configs/pricing';
import { ApiUsage } from '../../../src/models';
import { costAfterFreeTier, costOf, costReport, organizationApiUsage, previousMonth } from '../../../src/services/usage/cost';
import { currentUsage, flushUsage, recordUsage, setUsageContext, withUsage } from '../../../src/services/usage/scope';
import { detailsSkuFor, gbpSkuFor } from '../../../src/services/usage/skus';
import { createFakeTransport } from '../../helpers/fakeTransport';
import { clearDb, startTestDb } from '../../helpers/mongoose';

// Phase 12.5: the usage ledger (SKUs, attribution scopes, cost) and the cluster-wide Places limiter.

let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
	await ApiUsage.syncIndexes();
}, 60000);
afterAll(async () => db.stop());
beforeEach(async () => clearDb());

const month = new Date().toISOString().slice(0, 7);
const rows = () => ApiUsage.find({}).sort({ sku: 1 }).lean();

describe('SKUs', () => {
	it('Place Details bills on the highest tier among its fields', () => {
		expect(detailsSkuFor(['location'])).toBe('places.details.essentials');
		expect(detailsSkuFor(['id', 'displayName', 'formattedAddress', 'addressComponents', 'location', 'nationalPhoneNumber', 'websiteUri', 'primaryTypeDisplayName'])).toBe('places.details.enterprise');
		expect(detailsSkuFor(['id', 'photos'])).toBe('places.details.ids_only');
		expect(detailsSkuFor(['displayName', 'rating', 'reviews', 'photos'])).toBe('places.details.enterprise_atmosphere');
	});

	it('GBP calls are counted per API family', () => {
		expect(gbpSkuFor('https://mybusinessaccountmanagement.googleapis.com/v1/accounts')).toBe('gbp.account_management');
		expect(gbpSkuFor('https://businessprofileperformance.googleapis.com/v1/locations/1:fetchMultiDailyMetricsTimeSeries')).toBe('gbp.performance');
		expect(gbpSkuFor('https://mybusiness.googleapis.com/v4/accounts/1/locations/2/reviews')).toBe('gbp.v4');
		expect(gbpSkuFor('https://oauth2.googleapis.com/token')).toBe('gbp.oauth');
	});
});

describe('attribution scopes', () => {
	it('withUsage buffers per organization + location + SKU and writes once at the end; setUsageContext fills in ids', async () => {
		const org = new Types.ObjectId();
		const loc = new Types.ObjectId();
		await withUsage({ organization_id: org, location_id: null }, async () => {
			recordUsage('places.text.ids_only', 3);
			setUsageContext({ location_id: loc });
			expect(currentUsage()).toEqual({ organization_id: org, location_id: loc });
			recordUsage('places.text.ids_only', 2);
			recordUsage('places.text.pro');
			expect(await ApiUsage.countDocuments()).toBe(0); // buffered
		});
		expect(await rows()).toEqual([
			expect.objectContaining({ organization_id: org, location_id: loc, month, sku: 'places.text.ids_only', count: 5 }),
			expect.objectContaining({ organization_id: org, location_id: loc, month, sku: 'places.text.pro', count: 1 }),
		]);
		await withUsage({ organization_id: org, location_id: loc }, async () => {
			recordUsage('places.text.pro', 4);
			await flushUsage(); // long jobs flush from their heartbeat
			recordUsage('places.text.pro', 1);
		});
		expect((await ApiUsage.findOne({ sku: 'places.text.pro' }).lean())?.count).toBe(6);
	});

	it('writes even when the work throws; calls outside any scope are unattributed', async () => {
		await expect(
			withUsage({ organization_id: new Types.ObjectId(), location_id: null }, async () => {
				recordUsage('places.details.enterprise_atmosphere', 2);
				throw new Error('boom');
			}),
		).rejects.toThrow('boom');
		expect(await ApiUsage.countDocuments({ sku: 'places.details.enterprise_atmosphere', count: 2 })).toBe(1);
		recordUsage('gbp.oauth');
		await new Promise((r) => setTimeout(r, 50));
		expect(await ApiUsage.findOne({ sku: 'gbp.oauth' }).lean()).toMatchObject({ organization_id: null, location_id: null, count: 1 });
	});

	it('the Places client reports every HTTP attempt with its SKU, and waits on the limiter before each', async () => {
		const fake = createFakeTransport([
			{ status: 500, body: { error: { code: 500, message: 'x' } } },
			{ status: 200, body: { places: [{ id: 'ChIJa' }] } },
			{ status: 200, body: { id: 'ChIJa', displayName: { text: 'A' }, reviews: [{ rating: 4, text: { text: 'Good' }, authorAttribution: { displayName: 'Ann', uri: 'https://x' } }], photos: [{}, {}] } },
		]);
		const calls: [string, number][] = [];
		const acquire = jest.fn(async () => undefined);
		const client = createPlacesClient({ apiKey: 'k', transport: fake.transport, sleep: async () => undefined, limiter: { acquire }, onCall: (sku, n) => calls.push([sku, n]) });
		await client.searchTextIds({ textQuery: 'plumber', regionCode: 'ca', center: { latitude: 43, longitude: -79 }, maxPages: 1 });
		const d = await client.getPlaceDetails('ChIJa', ['displayName', 'reviews', 'photos']);
		expect(calls).toEqual([
			['places.text.ids_only', 2],
			['places.details.enterprise_atmosphere', 1],
		]);
		expect(acquire).toHaveBeenCalledTimes(3);
		expect(d.details).toMatchObject({ photoCount: 2, reviews: [{ rating: 4, text: 'Good', author: { name: 'Ann', uri: 'https://x' } }] });
	});
});

describe('cluster-wide limiter', () => {
	it('two processes (limiters) share one per-second budget in MongoDB', async () => {
		let t = 1_700_000_000_000;
		const slept: number[] = [];
		const sleep = async (ms: number) => {
			slept.push(ms);
			t += ms;
		};
		const a = createMongoLimiter({ maxPerSecond: 3, now: () => t, sleep, prefix: 'test' });
		const b = createMongoLimiter({ maxPerSecond: 3, now: () => t, sleep, prefix: 'test' });
		await a.acquire();
		await b.acquire();
		await a.acquire();
		expect(slept).toEqual([]);
		await b.acquire(); // 4th in the same second waits for the next one
		expect(slept).toHaveLength(1);
		expect(slept[0]).toBeGreaterThanOrEqual(1000 - (1_700_000_000_000 % 1000));
	});
});

describe('cost', () => {
	it('list price per 1,000; free allowances only in the project-wide total', () => {
		expect(costOf({ 'places.text.pro': 50, 'places.text.ids_only': 870, 'places.details.enterprise_atmosphere': 6 })).toBe(1.75);
		expect(costAfterFreeTier({ 'places.text.pro': 6000 })).toBe(32);
		expect(previousMonth('2026-01')).toBe('2025-12');
		expect(loadPricing(undefined)).toBe(DEFAULT_PRICING);
	});

	it('organization usage (this and last month) and the per-location cost report', async () => {
		const org = new Types.ObjectId();
		const loc = new Types.ObjectId();
		const prev = previousMonth(month);
		await ApiUsage.create([
			{ organization_id: org, location_id: loc, month, sku: 'places.text.pro', count: 50 },
			{ organization_id: org, location_id: loc, month, sku: 'places.text.ids_only', count: 870 },
			{ organization_id: org, location_id: null, month, sku: 'places.text.enterprise', count: 3 },
			{ organization_id: org, location_id: loc, month: prev, sku: 'places.text.pro', count: 10 },
			{ organization_id: null, location_id: null, month, sku: 'gbp.oauth', count: 2 },
		]);
		const usage = await organizationApiUsage(org);
		expect(usage).toMatchObject({ month, by_sku: { 'places.text.pro': 50, 'places.text.ids_only': 870, 'places.text.enterprise': 3 }, estimated_cost_usd: 1.71, previous_month: { month: prev, by_sku: { 'places.text.pro': 10 }, estimated_cost_usd: 0.32 } });
		const report = await costReport(month);
		expect(report.rows[0]).toMatchObject({ organization_id: String(org), location_id: String(loc), cost_usd: 1.6 });
		expect(report.rows).toHaveLength(3);
		expect(report.totals).toMatchObject({ 'places.text.pro': 50, 'gbp.oauth': 2 });
		expect(report.cost_after_free_tier_usd).toBe(0);
		expect((await costReport(month, { organizationId: org })).rows).toHaveLength(2);
	});
});
