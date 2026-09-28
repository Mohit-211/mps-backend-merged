/*
 * Phase 13b: sets up an EMPTY database for launch, in order (idempotent, safe to re-run):
 * indexes → reference data (dumps/) → standard billing plan (no prices) → citation directories → the
 * first super admin (SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD or a generated password shown once).
 * Refuses when the database already has organizations, unless --force. No Google or PayPal calls
 * (PayPal: npm run billing:paypal-setup).
 *
 *   npm run setup:fresh -- --confirm [--force] [--email=owner@example.com]
 */
import config from '../configs/config';
import { DatabaseNotEmptyError, setupFresh } from '../services/setup/setupFresh';
import { argValue, runWithDb } from './lib/withDb';

runWithDb('setup:fresh', async (db) => {
	if (!process.argv.includes('--confirm')) {
		process.stderr.write('setup:fresh writes to the database: re-run with --confirm.\n');
		return 2;
	}
	try {
		const r = await setupFresh({
			force: process.argv.includes('--force'),
			superAdmin: { email: argValue('email') ?? config.superAdmin.email, password: config.superAdmin.password || null },
		});
		const d = r.reference_data;
		const lines = [
			`Database ${db}: fresh setup done.`,
			`  indexes: ${r.indexes} models synced`,
			`  reference data inserted: roles ${d.roles}, countries ${d.countries}, states ${d.states}, cities ${d.cities}, languages ${d.languages}, time zones ${d.timezones}, business categories ${d.business_categories}`,
			`  standard billing plan: ${r.billing_plan.created ? 'created' : 'already there'} (prices set: ${r.billing_plan.prices}; add them in the billing admin before launch)`,
			`  citation directories: ${r.citations.directories_created} created, categories ${r.citations.categories_created} created`,
			r.super_admin.created
				? `  super admin created: ${r.super_admin.email}${r.super_admin.generated_password ? `\n  PASSWORD (shown once, store it now): ${r.super_admin.generated_password}` : ' (password from SUPER_ADMIN_PASSWORD)'}`
				: `  super admin: already exists (${r.super_admin.email})`,
			'Next: npm run billing:paypal-setup -- --confirm (PayPal), then npm start.',
		];
		process.stdout.write(`${lines.join('\n')}\n`);
		return 0;
	} catch (err) {
		if (err instanceof DatabaseNotEmptyError) {
			process.stderr.write(`${err.message}\n`);
			return 3;
		}
		throw err;
	}
});
