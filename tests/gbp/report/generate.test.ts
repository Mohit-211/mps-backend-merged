import { Types } from 'mongoose';
import { PlacesApiError, PlacesConfigError } from '../../../src/clients/placesClient';
import { HttpRequestError } from '../../../src/clients/http';
import { createDemoDetailsClient, writeDemoGbpData } from '../../../src/gbp/demo/demoGbp';
import { generateGbpReport } from '../../../src/gbp/report/generate';
import { GbpReport, GbpSync, IGbpReport, Location, RankRun, UserGBP } from '../../../src/models';
import { DEMO_PLACE_IDS } from '../../../src/ranking/demo/demoPlaces';
import { clearDb, createLocation, createUser, keywordsOf, startTestDb } from '../../helpers/mongoose';

jest.mock('../../../src/configs/mongoConnection', () => ({ agenda: {} }));

const NOW = new Date('2026-09-26T12:00:00Z');
const H = 3_600_000;

let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
	await Promise.all([GbpReport.syncIndexes(), GbpSync.syncIndexes(), UserGBP.syncIndexes()]);
}, 60000);
afterAll(async () => db.stop());
beforeEach(async () => clearDb());

/** A finished rank run: self averages 4.5 with a 0.5 top-3 rate; the map list has 4 other businesses. */
const insertRun = async (locationId: Types.ObjectId) => {
	await RankRun.collection.insertOne({
		location_id: locationId,
		status: 'done',
		active: false,
		run_at: new Date(NOW.getTime() - H),
		overall: { self: { overallAvgRank: 4.5, change: null } },
		tracker: [
			{ keyword: 'emergency plumber', summary: { self: { avgRank: 3, foundRate: 1, top3Rate: 0.6 } } },
			{ keyword: 'drain cleaning', summary: { self: { avgRank: 6, foundRate: 1, top3Rate: 0.4 } } },
		],
		mapList: [
			{
				keyword: 'emergency plumber',
				results: [
					{ rank: 1, place_id: DEMO_PLACE_IDS.competitor_1, is_self: false },
					{ rank: 2, place_id: DEMO_PLACE_IDS.self, is_self: true },
					{ rank: 3, place_id: 'ChIJdemoFillerAAAA', is_self: false },
					{ rank: 4, place_id: 'ChIJdemoFillerBBBB', is_self: false },
					{ rank: 5, place_id: 'ChIJdemoFillerCCCC', is_self: false },
				],
			},
			{ keyword: 'drain cleaning', results: [{ rank: 4, place_id: DEMO_PLACE_IDS.self, is_self: true }] },
		],
	});
};

const setup = async (bound: boolean) => {
	const { user } = await createUser(`u${Math.random()}@test.dev`);
	const location = await createLocation(user._id as Types.ObjectId, {
		place_id: DEMO_PLACE_IDS.self,
		tracking: { keywords: keywordsOf('emergency plumber', 'drain cleaning'), competitors: [DEMO_PLACE_IDS.competitor_2] },
	});
	await insertRun(location._id as Types.ObjectId);
	if (bound) await writeDemoGbpData({ _id: location._id as Types.ObjectId }, user._id as Types.ObjectId, NOW);
	return String(location._id);
};

const load = async (id: string) => (await GbpReport.findOne({ location_id: id }).lean<IGbpReport>()) as IGbpReport;

describe('generateGbpReport', () => {
	it('bound, v4 off: private sections from stored data, v4 sections pending, score partial; competitors fetched once each', async () => {
		const id = await setup(true);
		const places = createDemoDetailsClient();
		const result = await generateGbpReport(id, 'gbp_sync', { places, now: () => NOW, v4Enabled: false, withEditorialSummary: false });
		expect(result?.places_details).toBe(5); // self + 1 tracking + 3 from the map list
		const r = await load(id);
		expect(r).toMatchObject({ gbp_connected: true, v4_enabled: false, trigger: 'gbp_sync', api_calls: { places_details: 5 } });
		expect(r.performance.available).toBe(true);
		expect(r.keywords.available).toBe(true);
		expect(r.reviews).toEqual({ available: false, reason: 'v4_access_pending' });
		expect(r.media).toEqual({ available: false, reason: 'v4_access_pending' });
		expect(r.gbp_score).toMatchObject({ available: true, partial: true, excluded_pillars: ['activity', 'reviews'] });
		expect(r.pending_google_edits).toMatchObject({ available: true, has_pending: true });
		expect(r.sync).toMatchObject({ last_status: 'done' });
		if (!r.competitors.available) throw new Error('competitors missing');
		expect(r.competitors.rows.map((row) => [row.source, row.place_id])).toEqual([
			['self', DEMO_PLACE_IDS.self],
			['tracking', DEMO_PLACE_IDS.competitor_2],
			['map_list', DEMO_PLACE_IDS.competitor_1],
			['map_list', 'ChIJdemoFillerAAAA'],
			['map_list', 'ChIJdemoFillerBBBB'],
		]);
		expect(r.competitors.rows[0]).toMatchObject({ is_self: true, center_rank: { avg: 3, keywords_found: 2 } });
		expect(r.competitors.rows.every((row) => row.public_score !== null)).toBe(true);
		expect(r.competitors.insights.length).toBeGreaterThan(0);
		expect(r.score_history).toHaveLength(1);
		expect((await Location.findById(id).lean())?.gbp_report?.last_generated_at).toEqual(NOW);
	});

	it('v4 on: reviews, media and posts are filled and every pillar counts', async () => {
		const id = await setup(true);
		await generateGbpReport(id, 'seed', { places: createDemoDetailsClient(), now: () => NOW, v4Enabled: true, withEditorialSummary: false });
		const r = await load(id);
		expect(r.reviews).toMatchObject({ available: true, average_rating: 4.6, total: 64 });
		expect(r.media).toMatchObject({ available: true, owner_count: 14 });
		expect(r.posts).toMatchObject({ available: true, total: 9 });
		expect(r.gbp_score).toMatchObject({ available: true, partial: false, excluded_pillars: [] });
	});

	it('unbound (Places-search) location: private sections gbp_not_connected, public comparison still works', async () => {
		const id = await setup(false);
		await generateGbpReport(id, 'rank_run', { places: createDemoDetailsClient(), now: () => NOW, v4Enabled: false, withEditorialSummary: false });
		const r = await load(id);
		for (const section of ['performance', 'keywords', 'gbp_score', 'reviews', 'media', 'posts', 'pending_google_edits', 'verification', 'sync'] as const) {
			expect(r[section]).toEqual({ available: false, reason: 'gbp_not_connected' });
		}
		expect(r.competitors.available).toBe(true);
		expect(r.score_history[0]).toMatchObject({ gbp_score: null });
		expect(r.score_history[0].public_score).toBeGreaterThan(0);
	});

	it('a second generation reuses fresh rows (0 calls), keeps one document and grows the score history', async () => {
		const id = await setup(true);
		const places = createDemoDetailsClient();
		await generateGbpReport(id, 'gbp_sync', { places, now: () => NOW, v4Enabled: false });
		const second = await generateGbpReport(id, 'rank_run', { places, now: () => new Date(NOW.getTime() + 48 * H), v4Enabled: false });
		expect(second?.places_details).toBe(0);
		expect(places.calls()).toBe(5);
		expect(await GbpReport.countDocuments({ location_id: id })).toBe(1);
		const r = await load(id);
		expect(r.score_history).toHaveLength(2);
		expect(r.api_calls.places_details).toBe(0);
	});

	it('a new monthly cycle, or a manual refresh after 24 h, refetches; the force flag is consumed', async () => {
		const id = await setup(true);
		const places = createDemoDetailsClient();
		await generateGbpReport(id, 'gbp_sync', { places, now: () => NOW, v4Enabled: false });

		const later = new Date(NOW.getTime() + 30 * H);
		await Location.updateOne({ _id: id }, { $set: { 'gbp_report.force_competitors_at': new Date(later.getTime() - H) } });
		expect((await generateGbpReport(id, 'manual_refresh', { places, now: () => later, v4Enabled: false }))?.places_details).toBe(5);
		expect((await Location.findById(id).lean())?.gbp_report?.force_competitors_at).toBeNull();

		const nextCycle = new Date(later.getTime() + 30 * 24 * H);
		await Location.updateOne({ _id: id }, { $set: { 'refresh.anchor_day': 26, 'refresh.last_auto_refresh_at': new Date(nextCycle.getTime() - H) } });
		expect((await generateGbpReport(id, 'rank_run', { places, now: () => nextCycle, v4Enabled: false }))?.places_details).toBe(5);
	});

	it('Place Details failures keep the old facts (stale); no key keeps rows with a warning', async () => {
		const id = await setup(false);
		const good = createDemoDetailsClient();
		await generateGbpReport(id, 'rank_run', { places: good, now: () => NOW, v4Enabled: false });

		const failing = {
			getPlaceDetails: async (placeId: string) => {
				if (placeId === DEMO_PLACE_IDS.competitor_1) throw new PlacesApiError(new HttpRequestError({ message: 'HTTP 500', code: 'HTTP_ERROR', status: 500 }), 2);
				return good.getPlaceDetails(placeId);
			},
		};
		const later = new Date(NOW.getTime() + 30 * H);
		await Location.updateOne({ _id: id }, { $set: { 'gbp_report.force_competitors_at': later } });
		const result = await generateGbpReport(id, 'manual_refresh', { places: failing, now: () => new Date(later.getTime() + H), v4Enabled: false });
		expect(result?.places_details).toBe(4 + 2); // 4 succeeded + the failed one's 2 attempts
		let r = await load(id);
		if (!r.competitors.available) throw new Error('competitors missing');
		const failed = r.competitors.rows.find((row) => row.place_id === DEMO_PLACE_IDS.competitor_1);
		expect(failed).toMatchObject({ stale: true, name: 'Queen West Plumbing Co.' });
		expect(failed?.error).toContain('Places API request failed');

		const noKey = { getPlaceDetails: async () => Promise.reject(new PlacesConfigError()) };
		await Location.updateOne({ _id: id }, { $set: { 'gbp_report.force_competitors_at': new Date(later.getTime() + 30 * H) } });
		await generateGbpReport(id, 'manual_refresh', { places: noKey, now: () => new Date(later.getTime() + 60 * H), v4Enabled: false });
		r = await load(id);
		if (!r.competitors.available) throw new Error('competitors missing');
		expect(r.competitors.warning).toBe('places_not_configured');
		expect(r.competitors.rows.every((row) => row.stale)).toBe(true);
		expect(r.competitors.rows[0].name).toBe('Maple Leaf Plumbing & Heating');
	});

	it('returns null for an unknown or inactive location', async () => {
		expect(await generateGbpReport(String(new Types.ObjectId()), 'rank_run', { places: createDemoDetailsClient(), now: () => NOW })).toBeNull();
	});
});
