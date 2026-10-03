import express from 'express';
import request from 'supertest';
import { Types } from 'mongoose';
import { tokenTypes } from '../../src/configs/constantTypes';
import { queryTypesArr } from '../../src/configs/constantTypes';
import { Client, Directory, GbpMetricDaily, GbpReport, GbpReview, Location, LocationCitation, RankRun, Report, ReportSchedule, UserAuth, UserGBP } from '../../src/models';
import { updateCitationSummary } from '../../src/services/citations/summary';
import { apiErrorHandler, getQueryParams } from '../../src/utils';
import { addMember, clearDb, createLocation, createUser, ensureOrg, keywordsOf, startTestDb } from '../helpers/mongoose';

jest.mock('../../src/configs/mongoConnection', () => ({ agenda: {} }));

/* oxlint-disable typescript/no-var-requires */
const dashboardRoute = require('../../src/routes/v1/common/dashboard.route').default;
/* oxlint-enable typescript/no-var-requires */

const app = express();
app.use(express.json());
app.use(getQueryParams(queryTypesArr));
app.use('/api/v1/dashboard', dashboardRoute);
app.use(apiErrorHandler);

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
	await UserGBP.syncIndexes();
}, 60000);
afterAll(async () => db.stop());
beforeEach(async () => clearDb());

const done = { keywords: keywordsOf('plumber') };
const summary = (over: Record<string, unknown>) => ({
	overall_avg_rank: 10,
	overall_change: 0,
	last_run_at: new Date('2026-09-01'),
	top3_rate: 0.2,
	rank_trend: [{ run_at: new Date('2026-09-01'), overall_avg_rank: 10 }],
	movement: { improved: 0, declined: 0, unchanged: 1, entered_top_60: 0, dropped_out_of_top_60: 0, not_comparable: 0 },
	declines: [],
	key_competitor: null,
	gbp_score: null,
	gbp_grade: null,
	gbp_partial: null,
	gbp_score_change: null,
	top_fixes: [],
	gbp_issues: [],
	public_score: null,
	rating: null,
	review_count: null,
	reviews_available: false,
	unreplied: null,
	...over,
});

describe('GET /dashboard: business', () => {
	it('one location: its own numbers; no rank-run or report reads on a page view', async () => {
		const { user, token } = await createUser('b@test.dev');
		const loc = await createLocation(user._id as Types.ObjectId, { tracking: done });
		await UserAuth.collection.insertOne({ user_id: user._id, token_type: tokenTypes.GBP, google_sub: 's', status: 'active', is_active: true, deleted_at: null });
		await UserGBP.create({ user_id: user._id, location_id: loc._id, gbpAccountId: 'accounts/1', gbpLocationId: 'locations/1', google_sub: 's' });
		await Location.updateOne(
			{ _id: loc._id },
			{
				$set: {
					gbp_connected: true,
					summary: summary({
						overall_avg_rank: 8.4,
						overall_change: 2.1,
						movement: { improved: 2, declined: 1, unchanged: 0, entered_top_60: 1, dropped_out_of_top_60: 0, not_comparable: 0 },
						key_competitor: { place_id: 'C', name: 'Rival', avg_rank: 4, self_avg_rank: 8.4, ahead: true },
						gbp_score: 66,
						gbp_grade: 'C',
						gbp_score_change: 4,
						top_fixes: [{ id: 'recent_post', pillar: 'activity', label: 'Post weekly', fix_hint: 'Post', lost: 6 }],
						rating: 4.5,
						review_count: 40,
					}),
				},
			},
		);
		const runs = jest.spyOn(RankRun, 'find');
		const reports = jest.spyOn(GbpReport, 'findOne');
		const res = await request(app).get('/api/v1/dashboard').set(auth(token));
		expect(res.status).toBe(200);
		expect(runs).not.toHaveBeenCalled();
		expect(reports).not.toHaveBeenCalled();
		const d = res.body.data;
		expect(d).toMatchObject({
			type: 'business',
			locations_count: 1,
			visibility: { avg_rank: 8.4, change: 2.1, top3_rate: 0.2 },
			gbp: { available: true, score: 66, grade: 'C', change: 4 },
			reviews: { available: false, reason: 'v4_access_pending', public_rating: 4.5, public_review_count: 40 },
			movement: { improved: 2, declined: 1, entered_top_60: 1 },
			key_competitor: { name: 'Rival', ahead: true, location_id: String(loc._id) },
			status_counts: { active: 1 },
			attribution: { provider: 'Google', text: 'Google Maps' },
		});
		// The GBP fix (6 weighted points lost: 0.3) outranks the competitor gap (4.4 ranks: 0.22).
		expect(d.recommended_actions.map((a: { id: string }) => a.id)).toEqual(['gbp:recent_post', 'ranking:competitor_ahead']);
	});

	it('several locations: averages and summed movement; no data at all gives empty sections, not errors', async () => {
		const { user, token } = await createUser('m@test.dev');
		const uid = user._id as Types.ObjectId;
		const a = await createLocation(uid, { place_id: 'ChIJa00000000000000000001', tracking: done });
		const b = await createLocation(uid, { place_id: 'ChIJb00000000000000000001', tracking: done });
		await Location.updateOne({ _id: a._id }, { $set: { summary: summary({ overall_avg_rank: 6, overall_change: 2 }) } });
		await Location.updateOne({ _id: b._id }, { $set: { summary: summary({ overall_avg_rank: 10, overall_change: -1 }) } });
		const d = (await request(app).get('/api/v1/dashboard').set(auth(token))).body.data;
		expect(d.visibility).toMatchObject({ avg_rank: 8, change: 0.5 });
		expect(d.movement.unchanged).toBe(2);
		expect(d.gbp).toEqual({ available: false, reason: 'gbp_not_connected' });

		const { token: empty } = await createUser('e@test.dev');
		const { user: eu } = await createUser('e2@test.dev');
		await ensureOrg(eu._id);
		const none = await request(app).get('/api/v1/dashboard').set(auth(empty));
		expect(none.status).toBe(403); // no organization
		const blank = (await request(app).get('/api/v1/dashboard').set(auth((await createUser('blank@test.dev')).token))).status;
		expect(blank).toBe(403);
	});
});

describe('GET /dashboard: agency', () => {
	it('portfolio, statuses, declines, GBP issues, sorted and paged table; a client_user sees its clients only', async () => {
		const { user, token } = await createUser('a@test.dev');
		const org = await ensureOrg(user._id, 'agency');
		const uid = user._id as Types.ObjectId;
		const c1 = await Client.create({ company_name: 'Client One', organization_id: org._id });
		const c2 = await Client.create({ company_name: 'Client Two', organization_id: org._id });
		const up = await createLocation(uid, { name: 'Up', place_id: 'ChIJup0000000000000000001', client_id: c1._id as Types.ObjectId, tracking: done });
		const downLoc = await createLocation(uid, { name: 'Down', place_id: 'ChIJdown00000000000000001', client_id: c1._id as Types.ObjectId, tracking: done });
		const other = await createLocation(uid, { name: 'Other', place_id: 'ChIJother0000000000000001', client_id: c2._id as Types.ObjectId, tracking: { keywords: [] } });
		await Location.updateOne({ _id: up._id }, { $set: { summary: summary({ overall_avg_rank: 4, overall_change: 3, gbp_score: 80, gbp_grade: 'B', gbp_score_change: 2 }) } });
		await Location.updateOne(
			{ _id: downLoc._id },
			{
				$set: {
					summary: summary({
						overall_avg_rank: 20,
						overall_change: -5,
						movement: { improved: 0, declined: 2, unchanged: 0, entered_top_60: 0, dropped_out_of_top_60: 1, not_comparable: 0 },
						gbp_score: 40,
						gbp_grade: 'D',
						gbp_issues: [{ id: 'not_verified', label: 'The profile is not verified' }],
					}),
				},
			},
		);
		// Bound without a usable Google connection → reconnect_required.
		await UserGBP.create({ user_id: uid, location_id: downLoc._id, gbpAccountId: 'accounts/1', gbpLocationId: 'locations/2', google_sub: 'gone' });

		const d = (await request(app).get('/api/v1/dashboard?sort=rank&limit=2').set(auth(token))).body.data;
		expect(d).toMatchObject({
			type: 'agency',
			clients_count: 2,
			locations_count: 3,
			portfolio: { avg_rank: 12, avg_rank_change: -1, avg_gbp_score: 60, avg_gbp_score_change: 2 },
			status_counts: { active: 0, setup_required: 1, gbp_not_connected: 1, reconnect_required: 1 },
		});
		expect(d.declines).toEqual([expect.objectContaining({ name: 'Down', change: -5, declined_keywords: 2, dropped_out: 1, client: { client_id: String(c1._id), name: 'Client One' } })]);
		expect(d.gbp_issues).toEqual([expect.objectContaining({ name: 'Down', issues: [expect.objectContaining({ id: 'reconnect_required' }), expect.objectContaining({ id: 'not_verified' })] })]);
		expect(d.table).toMatchObject({ page: 1, limit: 2, total: 3, rows: [{ name: 'Up' }, { name: 'Down' }] });
		expect(d.recommended_actions[0]).toMatchObject({ id: 'connection:reconnect', location_name: 'Down' });
		const byChange = (await request(app).get('/api/v1/dashboard?sort=rank_change&order=asc').set(auth(token))).body.data.table.rows.map((r: { name: string }) => r.name);
		expect(byChange).toEqual(['Down', 'Up', 'Other']); // no data sorts last
		expect((await request(app).get('/api/v1/dashboard?sort=bogus').set(auth(token))).status).toBe(400);

		const { user: cu, token: cuToken } = await createUser('cu@test.dev');
		await addMember(org._id, cu._id, 'client_user', [c2._id as Types.ObjectId]);
		const mine = (await request(app).get('/api/v1/dashboard').set(auth(cuToken))).body.data;
		expect(mine).toMatchObject({ type: 'agency', clients_count: 1, locations_count: 1, table: { rows: [{ name: 'Other' }] } });
		expect(String(other._id)).toBe(mine.table.rows[0].location_id);
	});
});

describe('GET /dashboard: location filter, period picker and change fields (2026-10-02)', () => {
	const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
	const daily = (locationId: Types.ObjectId, fromDaysAgo: number, toDaysAgo: number, metric: string, value: number) =>
		Array.from({ length: fromDaysAgo - toDaysAgo + 1 }, (_, k) => ({ location_id: locationId, date: isoDaysAgo(toDaysAgo + k), metric, value }));

	it('business: ?location_id= narrows the blocks, ?range= drives performance and the rating change, change fields come from the summary', async () => {
		const { user, token } = await createUser('p@test.dev');
		const uid = user._id as Types.ObjectId;
		const a = await createLocation(uid, { name: 'A', place_id: 'ChIJpa0000000000000000001', tracking: done });
		const b = await createLocation(uid, { name: 'B', place_id: 'ChIJpb0000000000000000001', tracking: done });
		await Location.updateOne(
			{ _id: a._id },
			{
				$set: {
					gbp_connected: true,
					city: 'Fredericton',
					summary: summary({
						top3_rate: 0.4,
						top3_rate_change: 0.1,
						citation_score: 70,
						citation_score_change: 5,
						reputation: { total: 3, average_rating: 3.7, new_this_month: 1, positive: 2, negative: 1, unreplied: 1, awaiting_attention: 1, flagged: 0, suspicious: 0, drafts_pending: 0, replies_sent_this_month: 0, last_review_at: null, updated_at: new Date() },
					}),
				},
			},
		);
		await Location.updateOne({ _id: b._id }, { $set: { summary: summary({ top3_rate: 0, top3_rate_change: -0.3 }) } });
		// Latest data 3 days ago: the last 15 days at 10 impressions a day, the 15 before at 5; 1 call a day throughout.
		const aid = a._id as Types.ObjectId;
		await GbpMetricDaily.insertMany([
			...daily(aid, 17, 3, 'BUSINESS_IMPRESSIONS_MOBILE_MAPS', 10),
			...daily(aid, 32, 18, 'BUSINESS_IMPRESSIONS_MOBILE_MAPS', 5),
			...daily(aid, 32, 3, 'CALL_CLICKS', 1),
		]);
		const review = (rating: number, daysAgo: number, n: number) =>
			GbpReview.create({ location_id: aid, review_name: `r${n}`, rating, comment: 'x', reviewer: { display_name: 'R', is_anonymous: false }, create_time: new Date(Date.now() - daysAgo * 86_400_000), synced_at: new Date() });
		await review(5, 90, 1);
		await review(5, 80, 2);
		await review(1, 5, 3);

		const all = (await request(app).get('/api/v1/dashboard').set(auth(token))).body.data;
		expect(all).toMatchObject({ range: '30d', selected_location: null, locations_count: 2, visibility: { top3_rate: 0.2, top3_rate_change: -0.1 } });
		expect(all.locations).toEqual([expect.objectContaining({ name: 'A', city: 'Fredericton' }), expect.objectContaining({ name: 'B' })]);

		const res = await request(app).get(`/api/v1/dashboard?location_id=${String(aid)}&range=15d`).set(auth(token));
		expect(res.status).toBe(200);
		const d = res.body.data;
		expect(d).toMatchObject({
			range: '15d',
			selected_location: { location_id: String(aid), name: 'A', city: 'Fredericton' },
			locations_count: 2,
			visibility: { top3_rate: 0.4, top3_rate_change: 0.1 },
			citations: { available: true, score: 70, score_change: 5 },
			reviews: { available: true, rating: 3.7, rating_change: -1.33, new_in_range: 1 },
			performance: {
				available: true,
				range: '15d',
				days: 15,
				latest_date: isoDaysAgo(3),
				current: { impressions: 150, maps: 150, calls: 15, actions: 15 },
				previous: { impressions: 75, calls: 15 },
				change: { impressions: 1, calls: 0 },
			},
		});
		expect(d.locations).toHaveLength(2); // the picker keeps every location

		// B has no GBP: performance is unavailable; an unknown or foreign location is 404; a bad range is 400.
		const bOnly = (await request(app).get(`/api/v1/dashboard?location_id=${String(b._id)}`).set(auth(token))).body.data;
		expect(bOnly.performance).toEqual({ available: false, reason: 'gbp_not_connected', range: '30d' });
		const { user: other } = await createUser('o@test.dev');
		const foreign = await createLocation(other._id as Types.ObjectId, { place_id: 'ChIJpc0000000000000000001' });
		const nf = await request(app).get(`/api/v1/dashboard?location_id=${String(foreign._id)}`).set(auth(token));
		expect(nf.status).toBe(404);
		expect(nf.body.data).toMatchObject({ reason: 'location_not_found' });
		expect((await request(app).get('/api/v1/dashboard?range=28d').set(auth(token))).status).toBe(400);
		expect((await request(app).get('/api/v1/dashboard?location_id=nope').set(auth(token))).status).toBe(400);
	});

	it('agency: report counts, city and top-3 change on the rows, portfolio top-3 change', async () => {
		const { user, token } = await createUser('ag@test.dev');
		const org = await ensureOrg(user._id, 'agency');
		const uid = user._id as Types.ObjectId;
		const loc = await createLocation(uid, { name: 'Shop', place_id: 'ChIJag0000000000000000001', tracking: done });
		await Location.updateOne({ _id: loc._id }, { $set: { city: 'Dallas', summary: summary({ top3_rate_change: 0.25 }) } });
		const report = (status: string, type: string, archived = false) =>
			Report.create({ organization_id: org._id, location_id: loc._id, type, status, active: false, created_by: uid, archived_at: archived ? new Date() : null });
		await report('ready', 'rank_tracker');
		await report('ready', 'gbp_audit');
		await report('ready', 'citation', true);
		await report('failed', 'competitor_analysis');
		await ReportSchedule.create({ organization_id: org._id, scope: 'location', location_id: loc._id, type: 'rank_tracker', created_by: uid });
		await ReportSchedule.create({ organization_id: org._id, scope: 'location', location_id: loc._id, type: 'gbp_audit', status: 'paused', created_by: uid });

		const d = (await request(app).get('/api/v1/dashboard').set(auth(token))).body.data;
		expect(d).toMatchObject({ type: 'agency', range: '30d', reports: { ready: 2, scheduled: 1, failed: 1 }, portfolio: { avg_top3_rate_change: 0.25 } });
		expect(d.table.rows[0]).toMatchObject({ name: 'Shop', city: 'Dallas', visibility: { top3_rate_change: 0.25 } });
		expect(d.performance).toEqual({ available: false, reason: 'gbp_not_connected', range: '30d' });
	});
});

describe('Citation score change (2026-10-02)', () => {
	it('set when the score moves, kept while it stays the same', async () => {
		const { user } = await createUser('c@test.dev');
		const loc = await createLocation(user._id as Types.ObjectId, { place_id: 'ChIJcs0000000000000000001' });
		const dir = await Directory.create({ name: 'Yelp', url: 'https://www.yelp.com/', domain: 'yelp.com', type: 'general', countries: ['US', 'CA'] });
		const entry = await LocationCitation.create({ organization_id: loc.organization_id, location_id: loc._id, directory_id: dir._id, status: 'not_found' });
		const read = async () => (await Location.findById(loc._id).lean())?.summary;
		await updateCitationSummary(loc._id as Types.ObjectId);
		const first = await read();
		expect(first?.citation_score_change ?? null).toBeNull();
		await LocationCitation.updateOne({ _id: entry._id }, { $set: { status: 'live_correct' } });
		await updateCitationSummary(loc._id as Types.ObjectId);
		const second = await read();
		expect(second?.citation_score_change).toBe((second?.citation_score as number) - (first?.citation_score as number));
		expect(second?.citation_score_change).toBeGreaterThan(0);
		await updateCitationSummary(loc._id as Types.ObjectId);
		expect((await read())?.citation_score_change).toBe(second?.citation_score_change);
	});
});
