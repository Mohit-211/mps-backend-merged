/*
 * Phase 13b: loads the reference data from dumps/ (roles, countries, states, cities, languages, time
 * zones, business categories). Idempotent: only missing rows are inserted. Also run by setup:fresh.
 *
 *   npm run seed:reference-data -- [--confirm]
 */
import { seedReferenceData } from '../services/setup/referenceData';
import { runWithDb } from './lib/withDb';

runWithDb('seed:reference-data', async () => {
	const r = await seedReferenceData();
	process.stdout.write(`Reference data inserted: ${Object.entries(r).map(([k, v]) => `${k} ${v}`).join(', ')} (0 = already there).\n`);
	return 0;
});
