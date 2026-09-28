/*
 * Phase 13b (fresh database): creates the standard billing plan if it doesn't exist (no prices: set them
 * in the billing admin before launch). Idempotent. Also run by `npm run setup:fresh`.
 *
 *   npm run billing:setup-plan              (local database mps_rebuild)
 *   npm run billing:setup-plan -- --confirm (any other database)
 */
import mongoose from 'mongoose';
import config from '../configs/config';
import { setupStandardPlan } from '../services/setup/billingPlan';

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
			process.stderr.write(`Database is "${db}". Re-run with --confirm.\n`);
			return 2;
		}
		const r = await setupStandardPlan();
		process.stdout.write(`Standard plan ${r.created ? 'created' : 'already exists'} (${r.plan_id}); prices set: ${r.prices}.\n`);
		return 0;
	} finally {
		await mongoose.disconnect();
	}
};

main()
	.then((code) => process.exit(code))
	.catch((err: Error) => {
		process.stderr.write(`billing:setup-plan failed: ${err.message}\n`);
		process.exit(1);
	});
