import { Types } from 'mongoose';
import { BusinessCategory, CitationStatusLog, Directory, DirectoryCategory, Location, LocationCitation } from '../../../src/models';
import { writeDemoCitations } from '../../../src/services/citations/demo';
import { seedCitationDirectories } from '../../../src/services/citations/seed';
import { clearDb, createLocation, createUser, startTestDb } from '../../helpers/mongoose';

// Phase 16: the starter master list (src/scripts/data) and the demo citation lists (offline).

let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
}, 60000);
afterAll(async () => db.stop());
beforeEach(async () => clearDb());

describe('seed:citation-directories', () => {
	it('loads the GBP categories when empty, 5 category groups (every name found), 50 valid directories; idempotent', async () => {
		const first = await seedCitationDirectories();
		expect(first.business_categories_loaded).toBeGreaterThan(4000);
		expect(first.categories).toMatchObject({ created: 5, updated: 0, unchanged: 0, unknown_business_categories: [] });
		expect(first.directories).toMatchObject({ applied: true, rows: 50, created: 50, errors: [] });
		const types = await Directory.aggregate<{ _id: string; n: number }>([{ $group: { _id: '$type', n: { $sum: 1 } } }]);
		expect(Object.fromEntries(types.map((t) => [t._id, t.n]))).toEqual({ general: 20, niche: 18, government_chamber: 5, social: 4, aggregator: 3 });
		expect(await Directory.findOne({ domain: 'occ.ca' }).lean()).toMatchObject({ regions: ['ON'], countries: ['CA'] });
		const home = await DirectoryCategory.findOne({ slug: 'home-services' }).lean();
		expect(home?.business_category_ids.length).toBeGreaterThan(20);

		const again = await seedCitationDirectories();
		expect(again.business_categories_loaded).toBe(0);
		expect(again.categories).toMatchObject({ created: 0, updated: 0, unchanged: 5 });
		expect(again.directories).toMatchObject({ created: 0, updated: 0, unchanged: 50, applied: false });
		expect(await BusinessCategory.countDocuments({})).toBe(first.business_categories_loaded);
	}, 60000);
});

describe('demo citation lists', () => {
	it('suggests a list per location and records checks with mixed statuses and 60 days of history', async () => {
		await seedCitationDirectories();
		const { user } = await createUser('demo@test.dev');
		const loc = await createLocation(user._id as Types.ObjectId);
		const now = Date.now();
		const out = await writeDemoCitations([loc], now);
		// A Toronto (ON) plumber: general + aggregator + social directories for CA, the home-services niches, Ontario's chamber.
		expect(out.entries).toBe(await LocationCitation.countDocuments({ location_id: loc._id }));
		expect(out.entries).toBeGreaterThan(15);
		const statuses = new Set((await LocationCitation.find({ location_id: loc._id }).lean()).map((e) => e.status));
		for (const s of ['live_correct', 'nap_wrong', 'not_found', 'submitted', 'duplicate', 'pending', 'not_checked']) expect(statuses.has(s as never)).toBe(true);
		const wrong = await LocationCitation.findOne({ location_id: loc._id, status: 'nap_wrong' }).lean();
		expect(wrong?.mismatch_fields).toEqual(['phone']);
		const oldest = await CitationStatusLog.findOne({ location_id: loc._id }).sort({ at: 1 }).lean();
		expect(now - (oldest?.at.getTime() ?? now)).toBeGreaterThan(59 * 86_400_000);
		const summary = (await Location.findById(loc._id).lean())?.summary;
		expect(summary?.citation_score).toEqual(expect.any(Number));
		expect(summary?.citation_total).toBe(out.entries);
	}, 60000);
});
