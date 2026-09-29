/*
 * Phase 13b (fresh database): creates the standard billing plan if it doesn't exist (no prices: set them
 * in the billing admin before launch). Idempotent. Also run by setup:fresh.
 *
 *   npm run billing:setup-plan -- [--confirm]
 */
import { setupStandardPlan } from '../services/setup/billingPlan';
import { runWithDb } from './lib/withDb';

runWithDb('billing:setup-plan', async () => {
	const r = await setupStandardPlan();
	process.stdout.write(`Standard plan ${r.created ? 'created' : 'already exists'} (${r.plan_id}); prices set: ${r.prices}.\n`);
	return 0;
});
