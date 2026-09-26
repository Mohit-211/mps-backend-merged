/*
 * Writes the calibration sheet for one completed rank run. Makes NO API calls.
 *
 *   npm run calibrate -- <locationId> <runId> [--force]
 *
 * Output: docs/calibration/<run date>-<location>.csv, one row per keyword × sample point with our
 * rank for the client (api_rank), our top 3 (api_top3) and a Google Maps link. Fill in manual_rank /
 * manual_top3 from the link, then run `npm run calibrate:score -- <csv>`.
 * Refuses to overwrite an existing sheet (it may hold manual entries) unless --force is given.
 */
import fs from 'fs';
import path from 'path';
import mongoose, { Types } from 'mongoose';
import config from '../configs/config';
import { CALIBRATION_HEADER, buildCalibrationRows, calibrationFileName } from '../calibration/rows';
import { toCsv } from '../calibration/csv';
import { LeanRankRun, Location, RankRun } from '../models';

const OUT_DIR = path.resolve(process.cwd(), 'docs/calibration');

const main = async (): Promise<number> => {
	const args = process.argv.slice(2);
	const force = args.includes('--force');
	const [locationId, runId] = args.filter((a) => !a.startsWith('--'));
	if (!locationId || !runId || !Types.ObjectId.isValid(locationId) || !Types.ObjectId.isValid(runId)) {
		process.stderr.write('Usage: npm run calibrate -- <locationId> <runId> [--force]\n');
		return 2;
	}

	await mongoose.connect(config.databases.mongodb.url, {
		user: config.databases.mongodb.user,
		pass: config.databases.mongodb.password,
		authSource: config.databases.mongodb.authSource,
		serverSelectionTimeoutMS: 10000,
	});
	try {
		const location = await Location.findOne({ _id: locationId });
		if (!location) throw new Error('Location not found');
		const run = await RankRun.findOne({ _id: runId, location_id: locationId }).lean<LeanRankRun>();
		if (!run) throw new Error('Rank run not found for this location');
		if (!['done', 'partial'].includes(run.status)) throw new Error(`Run status is ${run.status}; only done or partial runs can be calibrated`);

		const rows = buildCalibrationRows(run);
		const file = path.join(OUT_DIR, calibrationFileName(new Date(run.run_at), location.name, location.city));
		if (fs.existsSync(file) && !force) {
			throw new Error(`${path.relative(process.cwd(), file)} already exists (it may contain manual entries). Use --force to overwrite.`);
		}
		fs.mkdirSync(OUT_DIR, { recursive: true });
		fs.writeFileSync(file, toCsv(CALIBRATION_HEADER, rows));

		const unknown = rows.filter((r) => String(r[7]).includes('(unknown:')).length;
		process.stdout.write(`Wrote ${path.relative(process.cwd(), file)}: ${rows.length} rows (0 API calls).\n`);
		if (unknown > 0) {
			process.stdout.write(
				`${unknown} rows have a top-3 place we cannot name without an API call; top-3 overlap will skip those rows.\n`,
			);
		}
		return 0;
	} finally {
		await mongoose.disconnect();
	}
};

main()
	.then((code) => process.exit(code))
	.catch((err: Error) => {
		process.stderr.write(`calibrate failed: ${err.message}\n`);
		process.exit(1);
	});
