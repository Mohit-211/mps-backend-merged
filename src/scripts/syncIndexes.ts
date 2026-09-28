/*
 * Syncs the indexes of the rebuilt (in-scope) models with their schemas: builds missing ones and drops
 * ones the schemas no longer define (e.g. the Phase 6 one-connection-per-user index on user_auths,
 * replaced in 7a by one per Google account; left in place it blocks connecting a second account).
 * Out-of-scope collections are not touched. No Google calls.
 *
 *   npm run db:sync-indexes              (local database mps_rebuild)
 *   npm run db:sync-indexes -- --confirm (any other database)
 */
import mongoose, { Model } from 'mongoose';
import config from '../configs/config';
import { PlacesRate } from '../clients/placesRateLimiter';
import {
	ApiUsage,
	AuthCode,
	CitationStatusLog,
	Client,
	Directory,
	DirectoryCategory,
	GbpKeywordMonthly,
	GbpMetricDaily,
	GbpProfileSnapshot,
	GbpReport,
	GbpReview,
	GbpSync,
	Invitation,
	Location,
	LocationCitation,
	Membership,
	OAuthState,
	Organization,
	PlacesUsage,
	RankRun,
	RankResultList,
	RateLimit,
	Report,
	ReportSchedule,
	ReportShare,
	ReportSnapshot,
	UserAuth,
	UserGBP,
} from '../models';

const MODELS: Record<string, Model<never>> = {
	UserAuth,
	UserGBP,
	OAuthState,
	PlacesUsage,
	Location,
	Client,
	RankRun,
	GbpSync,
	GbpMetricDaily,
	GbpKeywordMonthly,
	GbpProfileSnapshot,
	GbpReview,
	GbpReport,
	Organization,
	Membership,
	Invitation,
	AuthCode,
	RateLimit,
	Report,
	ReportSnapshot,
	ReportShare,
	ReportSchedule,
	RankResultList,
	ApiUsage,
	PlacesRate,
	// Phase 16: citations.
	Directory,
	DirectoryCategory,
	LocationCitation,
	CitationStatusLog,
} as unknown as Record<string, Model<never>>;

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
		for (const [name, model] of Object.entries(MODELS)) {
			const dropped = await model.syncIndexes();
			process.stdout.write(`${name.padEnd(20)} ${dropped.length ? `dropped: ${dropped.join(', ')}` : 'ok'}\n`);
		}
		return 0;
	} finally {
		await mongoose.disconnect();
	}
};

main()
	.then((code) => process.exit(code))
	.catch((err: Error) => {
		process.stderr.write(`db:sync-indexes failed: ${err.message}\n`);
		process.exit(1);
	});
