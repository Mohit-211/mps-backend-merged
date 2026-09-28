/*
 * Phase 16: seeds the starter citation master list: 5 directory categories (mapped to GBP business
 * categories) and ~50 US / CA directories from src/scripts/data. Idempotent (upserts by slug / domain;
 * never deletes). Loads dumps/businessCategory.json first when that collection is empty. No Google calls.
 *
 *   npm run seed:citation-directories              (local database mps_rebuild)
 *   npm run seed:citation-directories -- --confirm (any other database, e.g. to bootstrap production)
 */
import mongoose from 'mongoose';
import config from '../configs/config';
import { seedCitationDirectories } from '../services/citations/seed';

const main = async (): Promise<number> => {
	await mongoose.connect(config.databases.mongodb.url, {
		user: config.databases.mongodb.user,
		pass: config.databases.mongodb.password,
		authSource: config.databases.mongodb.authSource,
		serverSelectionTimeoutMS: 10000,
	});
	try {
		const db = mongoose.connection.db?.databaseName;
		if (db !== 'mps_rebuild' && !process.argv.includes('--confirm')) {
			process.stderr.write(`Database is "${db}". Re-run with --confirm to seed the citation directories there.\n`);
			return 2;
		}
		const r = await seedCitationDirectories();
		const d = r.directories;
		process.stdout.write(
			[
				`Database ${db}:`,
				r.business_categories_loaded ? `  business categories loaded from dumps/: ${r.business_categories_loaded}` : null,
				`  directory categories: ${r.categories.created} created, ${r.categories.updated} updated, ${r.categories.unchanged} unchanged`,
				r.categories.unknown_business_categories.length ? `  business categories not found: ${r.categories.unknown_business_categories.join('; ')}` : null,
				`  directories: ${d.rows} rows, ${d.created} created, ${d.updated} updated, ${d.unchanged} unchanged${d.errors.length ? `, ${d.errors.length} errors (nothing applied)` : ''}`,
				...d.errors.map((e) => `    line ${e.row} ${e.field}: ${e.message}`),
			]
				.filter(Boolean)
				.join('\n') + '\n',
		);
		return d.errors.length ? 1 : 0;
	} finally {
		await mongoose.disconnect();
	}
};

main()
	.then((code) => process.exit(code))
	.catch((err: Error) => {
		process.stderr.write(`seed:citation-directories failed: ${err.message}\n`);
		process.exit(1);
	});
