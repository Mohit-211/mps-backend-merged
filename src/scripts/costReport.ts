/*
 * Phase 12.5: Google API usage and estimated cost per organization and location for one month, from
 * the usage ledger (api_usage). Counts only are stored; prices come from src/configs/pricing.ts or the
 * JSON file in PRICING_FILE. No Google calls.
 *
 *   npm run cost:report                              (this month)
 *   npm run cost:report -- --month=2026-09 [--org=<organization id>] [--json]
 */
import mongoose from 'mongoose';
import config from '../configs/config';
import { loadPricing } from '../configs/pricing';
import { Location, Organization } from '../models';
import { costReport } from '../services/usage/cost';
import { monthOf } from '../services/usage/scope';

const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const out = (line = ''): void => {
	process.stdout.write(`${line}\n`);
};

const main = async (): Promise<number> => {
	const month = arg('month') ?? monthOf(new Date());
	if (!/^\d{4}-\d{2}$/.test(month)) {
		process.stderr.write('--month must be YYYY-MM\n');
		return 2;
	}
	await mongoose.connect(config.databases.mongodb.url, {
		user: config.databases.mongodb.user,
		pass: config.databases.mongodb.password,
		authSource: config.databases.mongodb.authSource,
		serverSelectionTimeoutMS: 10000,
	});
	try {
		const report = await costReport(month, { organizationId: arg('org'), pricing: loadPricing() });
		if (process.argv.includes('--json')) {
			out(JSON.stringify(report, null, 2));
			return 0;
		}
		const orgNames = new Map((await Organization.find({ _id: { $in: report.rows.map((r) => r.organization_id).filter(Boolean) } }).select({ name: 1 }).lean()).map((o) => [String(o._id), o.name]));
		const locNames = new Map((await Location.find({ _id: { $in: report.rows.map((r) => r.location_id).filter(Boolean) } }).select({ name: 1 }).lean()).map((l) => [String(l._id), l.name as string]));
		out(`Google API usage ${month} (prices: ${report.pricing_source}; USD at list price)`);
		out();
		for (const r of report.rows) {
			const who = r.purpose === 'sales_audit' ? '(sales audits)' : `${r.organization_id ? orgNames.get(r.organization_id) ?? r.organization_id : '(unattributed)'} / ${r.location_id ? locNames.get(r.location_id) ?? r.location_id : '(organization level)'}`;
			out(`${`$${r.cost_usd.toFixed(2)}`.padStart(9)}  ${who}`);
			for (const [sku, n] of Object.entries(r.by_sku)) out(`           ${sku.padEnd(40)} ${String(n).padStart(8)}`);
		}
		out();
		out('Totals:');
		for (const [sku, n] of Object.entries(report.totals)) out(`  ${sku.padEnd(40)} ${String(n).padStart(8)}`);
		out(`List price: $${report.cost_usd.toFixed(2)}; after Google's free monthly allowances (project-wide): $${report.cost_after_free_tier_usd.toFixed(2)}`);
		return 0;
	} finally {
		await mongoose.disconnect();
	}
};

main()
	.then((code) => process.exit(code))
	.catch((err: Error) => {
		process.stderr.write(`cost:report failed: ${err.message}\n`);
		process.exit(1);
	});
