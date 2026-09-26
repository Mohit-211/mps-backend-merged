/*
 * 7b migration: tracking.frequency weekly/monthly → auto_monthly, manual → manual_only, and a monthly
 * refresh schedule for every set-up location that has none. Idempotent; no Google calls.
 *
 *   npm run migrate:refresh              (local database mps_rebuild)
 *   npm run migrate:refresh -- --confirm (any other database: back up `locations` first)
 */
import mongoose from 'mongoose';
import config from '../configs/config';
import { migrateRefreshSchedule } from '../services/refresh/migrate';

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
			process.stderr.write(`Database is "${db}". Back up \`locations\`, then re-run with --confirm.\n`);
			return 2;
		}
		const result = await migrateRefreshSchedule();
		process.stdout.write(
			`Database ${db}: frequencies → auto_monthly ${result.frequencies.auto_monthly}, manual_only ${result.frequencies.manual_only}; schedules set ${result.scheduled}.\n`,
		);
		return 0;
	} finally {
		await mongoose.disconnect();
	}
};

main()
	.then((code) => process.exit(code))
	.catch((err: Error) => {
		process.stderr.write(`migrate:refresh failed: ${err.message}\n`);
		process.exit(1);
	});
