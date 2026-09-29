/*
 * Syncs every model's indexes with its schema: builds missing ones and drops ones the schemas no longer
 * define. No Google calls. Also run by setup:fresh.
 *
 *   npm run db:sync-indexes              (local database mps_rebuild)
 *   npm run db:sync-indexes -- --confirm (any other database)
 */
import { syncAllIndexes } from '../services/setup/indexes';
import { runWithDb } from './lib/withDb';

runWithDb('db:sync-indexes', async () => {
	for (const r of await syncAllIndexes()) process.stdout.write(`${r.model.padEnd(22)} ${r.dropped.length ? `dropped: ${r.dropped.join(', ')}` : 'ok'}\n`);
	return 0;
});
