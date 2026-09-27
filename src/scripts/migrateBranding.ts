/*
 * Phase 12 migration: legacy white-label profiles → organization branding (agencies without branding
 * only; never overwrites). Copies the logo from public/uploads/images into REPORTS_STORAGE_DIR.
 * Idempotent; no Google calls. Prints organization ids and names only.
 *
 *   npm run migrate:branding                       (local database mps_rebuild)
 *   npm run migrate:branding -- --dry-run          (print what would change)
 *   npm run migrate:branding -- --confirm          (any other database: back up organizations first)
 */
import path from 'path';
import mongoose from 'mongoose';
import config from '../configs/config';
import { migrateBranding } from '../services/reports/migrateBranding';

const main = async (): Promise<number> => {
	await mongoose.connect(config.databases.mongodb.url, {
		user: config.databases.mongodb.user,
		pass: config.databases.mongodb.password,
		authSource: config.databases.mongodb.authSource,
		serverSelectionTimeoutMS: 10000,
	});
	try {
		const db = mongoose.connection.db?.databaseName;
		const dryRun = process.argv.includes('--dry-run');
		if (db !== 'mps_rebuild' && !dryRun && !process.argv.includes('--confirm')) {
			process.stderr.write(`Database is "${db}". Back up organizations, then re-run with --confirm (or --dry-run).\n`);
			return 2;
		}
		const rows = await migrateBranding({ uploadsDir: path.resolve(process.cwd(), 'public/uploads/images'), dryRun });
		process.stdout.write(`Database ${db}${dryRun ? ' (dry run)' : ''}: ${rows.filter((r) => r.result === 'migrated').length} of ${rows.length} agency organization(s) migrated.\n\n`);
		for (const r of rows) process.stdout.write(`${r.organization_id}  ${r.result.padEnd(12)}  logo: ${(r.logo ?? '-').padEnd(12)}  ${r.organization}\n`);
		return 0;
	} finally {
		await mongoose.disconnect();
	}
};

main()
	.then((code) => process.exit(code))
	.catch((err: Error) => {
		process.stderr.write(`migrate:branding failed: ${err.message}\n`);
		process.exit(1);
	});
