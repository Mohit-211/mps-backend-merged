import express from 'express';
import request from 'supertest';
import { Types } from 'mongoose';
import { tokenTypes } from '../../src/configs/constantTypes';
import { queryTypesArr } from '../../src/configs/constantTypes';
import { Client, GbpReport, Location, RankRun, UserAuth, UserGBP } from '../../src/models';
import { apiErrorHandler, getQueryParams } from '../../src/utils';
import { addMember, clearDb, createLocation, createUser, ensureOrg, keywordsOf, startTestDb } from '../helpers/mongoose';

jest.mock('../../src/configs/mongoConnection', () => ({ agenda: {} }));

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const dashboardRoute = require('../../src/routes/v1/common/dashboard.route').default;
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

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
