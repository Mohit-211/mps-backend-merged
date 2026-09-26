import { Agenda } from 'agenda';
import { Types } from 'mongoose';
import { tokenTypes } from '../../../src/configs/constantTypes';
import { AuthCode, GbpSync, Location, RankRun, RateLimit, UserAuth, UserGBP } from '../../../src/models';
import { checkCode, issueCode } from '../../../src/services/auth/codes';
import { LIMITS, hit } from '../../../src/services/auth/rateLimit';
import { removeLocation } from '../../../src/services/locations/remove.service';
import { statusOf, statusesFor } from '../../../src/services/locations/status';
import { updateSummaryFromReport, updateSummaryFromRuns } from '../../../src/services/locations/summary';
import { resolveOrgContext } from '../../../src/services/org/context';
import { clearDb, createLocation, createUser, ensureOrg, keywordsOf, startTestDb } from '../../helpers/mongoose';

jest.mock('../../../src/configs/mongoConnection', () => ({ agenda: {} }));

let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
	await Promise.all([AuthCode.syncIndexes(), RateLimit.syncIndexes(), UserGBP.syncIndexes(), GbpSync.syncIndexes()]);
}, 60000);
afterAll(async () => db.stop());
beforeEach(async () => clearDb());

describe('location status', () => {
	it('setup_required > reconnect_required > gbp_not_connected > active', () => {
		const done = { _id: new Types.ObjectId(), tracking: { keywords: keywordsOf('x') } } as never;
		expect(statusOf({ _id: new Types.ObjectId(), onboarding: { step: 'keywords_set', started_at: new Date(), completed_at: null } } as never, null)).toBe('setup_required');
		expect(statusOf({ _id: new Types.ObjectId(), tracking: { keywords: [] } } as never, { revoked: true })).toBe('setup_required');
		expect(statusOf(done, { revoked: true })).toBe('reconnect_required');
		expect(statusOf(done, null)).toBe('gbp_not_connected');
		expect(statusOf(done, { revoked: false })).toBe('active');
	});

	it('batched: a binding whose Google connection is revoked or missing needs a reconnect', async () => {
		const { user } = await createUser('s@test.dev');
		const tracking = { keywords: keywordsOf('plumber') };
		const ok = await createLocation(user._id as Types.ObjectId, { place_id: 'ChIJok000000000000000001', tracking });
		const revoked = await createLocation(user._id as Types.ObjectId, { place_id: 'ChIJrev00000000000000001', tracking });
		const plain = await createLocation(user._id as Types.ObjectId, { place_id: 'ChIJpln00000000000000001', tracking });
		await UserAuth.collection.insertMany([
			{ user_id: user._id, token_type: tokenTypes.GBP, google_sub: 'a', status: 'active', is_active: true, deleted_at: null },
			{ user_id: user._id, token_type: tokenTypes.GBP, google_sub: 'b', status: 'revoked', is_active: true, deleted_at: null },
		]);
		await UserGBP.create({ user_id: user._id, location_id: ok._id, gbpAccountId: 'accounts/1', gbpLocationId: 'locations/1', google_sub: 'a' });
		await UserGBP.create({ user_id: user._id, location_id: revoked._id, gbpAccountId: 'accounts/1', gbpLocationId: 'locations/2', google_sub: 'b' });
		const statuses = await statusesFor([ok, revoked, plain]);
		expect([statuses.get(String(ok._id)), statuses.get(String(revoked._id)), statuses.get(String(plain._id))]).toEqual(['active', 'reconnect_required', 'gbp_not_connected']);
	});
});

describe('summary', () => {
	it('from the latest done/partial run and from a report', async () => {
		const { user } = await createUser('m@test.dev');
		const loc = await createLocation(user._id as Types.ObjectId);
		await RankRun.collection.insertMany([
			{ location_id: loc._id, status: 'done', run_at: new Date('2026-08-01'), finished_at: new Date('2026-08-01T00:02:00Z'), overall: { self: { overallAvgRank: 9, change: null } } },
			{ location_id: loc._id, status: 'partial', run_at: new Date('2026-09-01'), finished_at: new Date('2026-09-01T00:02:00Z'), overall: { self: { overallAvgRank: 6.5, change: 2.5 } } },
			{ location_id: loc._id, status: 'failed', run_at: new Date('2026-09-20'), overall: {} },
		]);
		await updateSummaryFromRuns(loc._id as Types.ObjectId);
		await updateSummaryFromReport(loc._id as Types.ObjectId, {
			gbp_score: { available: true, score: 64, grade: 'C', partial: true } as never,
			competitors: { available: true, rows: [{ is_self: true, rating: 4.4, user_rating_count: 31, public_score: { score: 58 } }] } as never,
			reviews: { available: false, reason: 'v4_access_pending' },
		});
		expect((await Location.findById(loc._id).lean())?.summary).toMatchObject({
			overall_avg_rank: 6.5,
			overall_change: 2.5,
			gbp_score: 64,
			gbp_grade: 'C',
			gbp_partial: true,
			public_score: 58,
			rating: 4.4,
			review_count: 31,
		});
	});
});

describe('soft delete', () => {
	it('ends active runs/syncs, cancels their jobs, unbinds GBP, keeps history and frees the slot', async () => {
		const { user } = await createUser('d@test.dev');
		const org = await ensureOrg(user._id);
		const loc = await createLocation(user._id as Types.ObjectId);
		const run = await RankRun.collection.insertOne({ location_id: loc._id, status: 'queued', active: true, run_at: new Date() });
		await RankRun.collection.insertOne({ location_id: loc._id, status: 'done', active: false, run_at: new Date('2026-01-01') });
		await GbpSync.collection.insertOne({ location_id: loc._id, status: 'running', active: true, run_at: new Date() });
		await UserGBP.create({ user_id: user._id, location_id: loc._id, gbpAccountId: 'accounts/1', gbpLocationId: 'locations/1' });
		const cancel = jest.fn(async () => 1);
		const unbind = jest.fn(async () => ({ unbound: true }));
		const ctx = await resolveOrgContext(String(user._id));
		const result = await removeLocation(ctx, loc, { agenda: { cancel } as unknown as Agenda, unbind });
		expect(result).toMatchObject({ deleted: true, gbp_unbound: true, jobs_cancelled: { rank_run: 1, gbp_sync: 1, gbp_report: 1 }, usage: { used: 0, limit: 1 } });
		expect(unbind).toHaveBeenCalledWith(String(user._id), String(loc._id));
		expect(cancel).toHaveBeenCalledWith({ name: 'rank-run', 'data.run_id': { $in: [String(run.insertedId)] } });
		const raw = await Location.collection.findOne({ _id: loc._id });
		expect(raw).toMatchObject({ is_active: false, deleted_by: user._id });
		expect(await RankRun.countDocuments({ location_id: loc._id })).toBe(2);
		expect(await RankRun.countDocuments({ location_id: loc._id, active: true })).toBe(0);
		expect(await Location.countDocuments({ organization_id: org._id, is_active: true })).toBe(0);
	});
});

describe('auth codes', () => {
	it('single use even with parallel checks; a new code replaces the old one', async () => {
		const userId = new Types.ObjectId();
		const code = await issueCode(userId, 'verify_email');
		const results = await Promise.all([checkCode(userId, 'verify_email', code), checkCode(userId, 'verify_email', code), checkCode(userId, 'verify_email', code)]);
		expect(results.filter((r) => r.ok)).toHaveLength(1);
		const old = await issueCode(userId, 'reset_password');
		const fresh = await issueCode(userId, 'reset_password');
		if (old !== fresh) expect(await checkCode(userId, 'reset_password', old)).toMatchObject({ ok: false, reason: 'invalid_code' });
		expect(await checkCode(userId, 'reset_password', fresh)).toEqual({ ok: true });
		expect(await AuthCode.countDocuments({ user_id: userId })).toBe(2);
	});
});

describe('rate limits', () => {
	it('counts per key in a fixed window and resets after it', async () => {
		const t0 = new Date('2026-09-26T12:00:00Z');
		for (let i = 0; i < 3; i += 1) await hit(LIMITS.resendPerEmail, ['a@x.test'], t0);
		await expect(hit(LIMITS.resendPerEmail, ['a@x.test'], new Date(t0.getTime() + 1000))).rejects.toMatchObject({
			statusCode: 429,
			data: { reason: 'rate_limited', retry_after_seconds: 3599 },
		});
		await expect(hit(LIMITS.resendPerEmail, ['b@x.test'], t0)).resolves.toBeUndefined();
		await expect(hit(LIMITS.resendPerEmail, ['a@x.test'], new Date(t0.getTime() + 3601_000))).resolves.toBeUndefined();
		const keys = (await RateLimit.find().lean()).map((r) => r.key);
		expect(keys.join()).not.toContain('a@x.test');
	});
});
