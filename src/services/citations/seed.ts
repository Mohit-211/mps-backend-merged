import fs from 'fs';
import path from 'path';
import { Types } from 'mongoose';
import { BusinessCategory, DirectoryCategory } from '../../models';
import { AdminActor, escapeRegex } from './common';
import { directoryCsvService, ImportResult } from './csv';

// The starter citation master list (Phase 16): 5 directory categories mapped to GBP business categories
// and ~50 US / CA directories (src/scripts/data). Idempotent: categories upsert by slug, directories by
// domain (the CSV import). Used by `npm run seed:citation-directories` (also to bootstrap production,
// which the admin team then edits) and by `seed:demo-orgs`.

export const SEED_DATA_DIR = path.resolve(__dirname, '../../scripts/data');
const DUMP_BUSINESS_CATEGORIES = path.resolve(__dirname, '../../../dumps/businessCategory.json');
export const SEED_ACTOR: AdminActor = { id: '', name: 'Seed' };

interface CategorySeed {
	slug: string;
	name: string;
	business_categories: string[];
}

export interface SeedResult {
	/** Rows loaded from dumps/businessCategory.json because the collection was empty (else 0). */
	business_categories_loaded: number;
	categories: { created: number; updated: number; unchanged: number; unknown_business_categories: string[] };
	directories: ImportResult;
}

export const seedCitationDirectories = async (opts: { dataDir?: string; loadBusinessCategories?: boolean } = {}): Promise<SeedResult> => {
	const dir = opts.dataDir ?? SEED_DATA_DIR;
	let loaded = 0;
	// The GBP categories are reference data (normally loaded by `npm run mongo-migrate`); without them no
	// location can match a directory category.
	if ((opts.loadBusinessCategories ?? true) && (await BusinessCategory.estimatedDocumentCount()) === 0 && fs.existsSync(DUMP_BUSINESS_CATEGORIES)) {
		const rows = JSON.parse(fs.readFileSync(DUMP_BUSINESS_CATEGORIES, 'utf8')) as { name: string; slug: string }[];
		await BusinessCategory.insertMany(rows, { ordered: false });
		loaded = rows.length;
	}

	const seeds = (JSON.parse(fs.readFileSync(path.join(dir, 'directory-categories.json'), 'utf8')) as { categories: CategorySeed[] }).categories;
	const categories = { created: 0, updated: 0, unchanged: 0, unknown_business_categories: [] as string[] };
	for (const c of seeds) {
		const found = await BusinessCategory.find({ name: { $in: c.business_categories.map((n) => new RegExp(`^${escapeRegex(n)}$`, 'i')) } })
			.select({ name: 1 })
			.lean<{ _id: Types.ObjectId; name: string }[]>();
		const foundNames = new Set(found.map((f) => f.name.toLowerCase()));
		categories.unknown_business_categories.push(...c.business_categories.filter((n) => !foundNames.has(n.toLowerCase())).map((n) => `${c.slug}: ${n}`));
		const ids = found.map((f) => String(f._id)).sort();
		const current = await DirectoryCategory.findOne({ slug: c.slug }).lean<{ name: string; is_active: boolean; business_category_ids: Types.ObjectId[] }>();
		if (current && current.name === c.name && current.is_active && current.business_category_ids.map(String).sort().join() === ids.join()) {
			categories.unchanged += 1;
			continue;
		}
		const res = await DirectoryCategory.updateOne(
			{ slug: c.slug },
			{ $set: { name: c.name, business_category_ids: found.map((f) => f._id), is_active: true }, $setOnInsert: { slug: c.slug, created_by: null } },
			{ upsert: true },
		);
		if (res.upsertedCount) categories.created += 1;
		else categories.updated += 1;
	}

	const csv = fs.readFileSync(path.join(dir, 'citation-directories.csv'), 'utf8');
	const directories = await directoryCsvService.importCsv(csv, { dryRun: false }, SEED_ACTOR);
	return { business_categories_loaded: loaded, categories, directories };
};
