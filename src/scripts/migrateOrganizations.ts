/*
 * Phase 8 migration: every existing account gets an organization (agency / business owners), employees
 * become members, and locations and clients get their organization, source, gbp_connected and list
 * summary. Duplicate place_ids within an organization are reported, never changed. Idempotent; no
 * Google calls. Prints the mapping (user ids and organization names; no emails).
 *
 *   npm run migrate:organizations              (local database mps_rebuild)
 *   npm run migrate:organizations -- --confirm (any other database: back up users, locations, clients first)
 */
import mongoose from 'mongoose';
import config from '../configs/config';
import { Location, Membership, Organization } from '../models';
import { migrateOrganizations } from '../services/org/migrate';

const out = (line = ''): void => {
	process.stdout.write(`${line}\n`);
};

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
			process.stderr.write(`Database is "${db}". Back up users, locations and clients, then re-run with --confirm.\n`);
			return 2;
		}
		await Promise.all([Organization.syncIndexes(), Membership.syncIndexes()]);
		const report = await migrateOrganizations();
		out(`Database ${db}: organizations created ${report.organizations_created}, memberships created ${report.memberships_created}.`);
		out();
		out('User                       Type       Role    Organization (type)');
		for (const row of report.users) {
			const org = row.organization ? `${row.organization.name} (${row.organization.type})${row.organization.created ? ' [new]' : ''}` : `– ${row.note ?? ''}`;
			out(`${row.user_id}  ${(row.user_type ?? 'none').padEnd(9)}  ${(row.role ?? '-').padEnd(6)}  ${org}`);
		}
		out();
		out(`Locations assigned: ${report.locations_assigned}; without an owner organization: ${report.locations_without_owner.length ? report.locations_without_owner.join(', ') : 'none'}.`);
		out(`Clients assigned: ${report.clients_assigned}. Location summaries updated: ${report.summaries_updated}.`);
		if (report.duplicates.length) {
			out();
			out('Duplicate place_ids within an organization (resolve by deleting one location, then re-run):');
			for (const d of report.duplicates) out(`  organization ${d.organization_id} place ${d.place_id}: locations ${d.location_ids.join(', ')}`);
			return 3;
		}
		await Location.syncIndexes();
		out('Indexes synced (one place_id per organization).');
		return 0;
	} finally {
		await mongoose.disconnect();
	}
};

main()
	.then((code) => process.exit(code))
	.catch((err: Error) => {
		process.stderr.write(`migrate:organizations failed: ${err.message}\n`);
		process.exit(1);
	});
