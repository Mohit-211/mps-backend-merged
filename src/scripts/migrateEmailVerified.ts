/*
 * Phase 8.1 migration: marks every existing user as email-verified (email verification became a link and
 * login now requires it). Run it BEFORE the Phase 8.1 code starts on a database with users, or they can't
 * log in. Idempotent; no emails are sent. The unverified-cleanup job never touches these accounts (only
 * signups made by Phase 8.1 code carry a verification deadline).
 *
 *   npm run migrate:email-verified              (local database mps_rebuild)
 *   npm run migrate:email-verified -- --confirm (any other database: back up `users` first)
 */
import mongoose from 'mongoose';
import config from '../configs/config';
import { User } from '../models';
import { migrateExistingUsersVerified } from '../services/auth/emailVerification';

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
			process.stderr.write(`Database is "${db}". Back up \`users\`, then re-run with --confirm.\n`);
			return 2;
		}
		const result = await migrateExistingUsersVerified();
		// The cleanup job's index (users.verification_deadline). createIndexes only adds, never drops legacy indexes.
		await User.createIndexes();
		process.stdout.write(`Database ${db}: users marked verified ${result.marked_verified}; PENDING/REVIEWING → ACCEPTED ${result.status_accepted}.\n`);
		return 0;
	} finally {
		await mongoose.disconnect();
	}
};

main()
	.then((code) => process.exit(code))
	.catch((err: Error) => {
		process.stderr.write(`migrate:email-verified failed: ${err.message}\n`);
		process.exit(1);
	});
