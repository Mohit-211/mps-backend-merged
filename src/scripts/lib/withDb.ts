import mongoose from 'mongoose';
import config from '../../configs/config';

/**
 * Connects, runs `fn`, disconnects, exits with its code. Any database other than the local mps_rebuild
 * needs --confirm (the standing rule for every script that writes).
 */
export const runWithDb = (name: string, fn: (db: string) => Promise<number>): void => {
	const main = async (): Promise<number> => {
		await mongoose.connect(config.databases.mongodb.url, {
			user: config.databases.mongodb.user,
			pass: config.databases.mongodb.password,
			authSource: config.databases.mongodb.authSource,
			serverSelectionTimeoutMS: 10000,
		});
		try {
			const db = mongoose.connection.db?.databaseName ?? '';
			if (db !== 'mps_rebuild' && !process.argv.includes('--confirm')) {
				process.stderr.write(`Database is "${db}". Re-run with --confirm.\n`);
				return 2;
			}
			return await fn(db);
		} finally {
			await mongoose.disconnect();
		}
	};
	main()
		.then((code) => process.exit(code))
		.catch((err: Error) => {
			process.stderr.write(`${name} failed: ${err.message}\n`);
			process.exit(1);
		});
};

/** `--name=value` from argv. */
export const argValue = (name: string): string | null => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
