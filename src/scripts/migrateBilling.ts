/*
 * Phase 13a migration (billing). Dry run by default: prints what would change. Idempotent.
 *   - creates the standard plan (no prices: set them in the billing admin before launch)
 *   - links paid legacy guest-checkout PayPal subscriptions to the organization owned by the verified
 *     user with the same email; lists the unmatched ones (link them with the admin endpoint)
 *   - gives every organization without a trial end a trial from now (the standard trial length)
 *   - deactivates the legacy per-plan coupons (coupons are token-pack only now)
 *
 *   npm run migrate:billing                      (dry run)
 *   npm run migrate:billing -- --confirm         (apply; back up organizations, subscriptions, coupons first)
 */
import mongoose from 'mongoose';
import config from '../configs/config';
import { migrateBilling } from '../services/billing/migrate';

const main = async (): Promise<number> => {
	const apply = process.argv.includes('--confirm');
	await mongoose.connect(config.databases.mongodb.url, {
		user: config.databases.mongodb.user,
		pass: config.databases.mongodb.password,
		authSource: config.databases.mongodb.authSource,
		serverSelectionTimeoutMS: 10000,
	});
	try {
		const db = mongoose.connection.db?.databaseName;
		const r = await migrateBilling({ apply });
		const out = [
			`Database ${db}: ${apply ? 'APPLIED' : 'dry run (add --confirm to apply)'}`,
			`standard plan: ${r.standard_plan}`,
			`legacy subscriptions: ${r.legacy.linked.length} ${apply ? 'linked' : 'to link'}, ${r.legacy.already_linked} already linked, ${r.legacy.unmatched.length} unmatched`,
			...r.legacy.linked.map((l) => `  link payment ${l.payment_id} → organization ${l.organization_id}`),
			...r.legacy.unmatched.map((u) => `  unmatched payment ${u.payment_id} (${u.email ? u.email.replace(/^(.).*(@.*)$/, '$1***$2') : 'no email'}): ${u.reason}`),
			`trials ${apply ? 'started' : 'to start'}: ${r.trials_started}`,
			`legacy coupons ${apply ? 'deactivated' : 'to deactivate'}: ${r.coupons_deactivated}`,
		];
		process.stdout.write(`${out.join('\n')}\n`);
		return 0;
	} finally {
		await mongoose.disconnect();
	}
};

main()
	.then((code) => process.exit(code))
	.catch((err: Error) => {
		process.stderr.write(`migrate:billing failed: ${err.message}\n`);
		process.exit(1);
	});
