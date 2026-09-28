/*
 * Phase 11: recomputes every active location's summary (Location.summary: list and dashboard numbers)
 * from its latest rank runs and GBP report. Idempotent; no Google calls.
 *
 *   npm run summaries:rebuild              (local database mps_rebuild)
 *   npm run summaries:rebuild -- --confirm (any other database)
 */
import mongoose, { Types } from 'mongoose';
import config from '../configs/config';
import { GbpReport, IGbpReport, Location } from '../models';
import { updateSummaryFromReport, updateSummaryFromRuns } from '../services/locations/summary';
import { updateCitationSummary } from '../services/citations/summary';

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
		const locations = await Location.find({ is_active: true, organization_id: { $ne: null } }).select({ _id: 1 }).lean();
		let reports = 0;
		for (const { _id } of locations) {
			await updateSummaryFromRuns(_id as Types.ObjectId);
			const report = await GbpReport.findOne({ location_id: _id }).lean<IGbpReport>();
			if (report) {
				await updateSummaryFromReport(_id as Types.ObjectId, report);
				reports += 1;
			}
			// Phase 16: Citation Health.
			await updateCitationSummary(_id as Types.ObjectId);
		}
		process.stdout.write(`Database ${db}: ${locations.length} location summaries rebuilt (${reports} with a GBP report).\n`);
		return 0;
	} finally {
		await mongoose.disconnect();
	}
};

main()
	.then((code) => process.exit(code))
	.catch((err: Error) => {
		process.stderr.write(`summaries:rebuild failed: ${err.message}\n`);
		process.exit(1);
	});
