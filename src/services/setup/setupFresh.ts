import { Organization } from '../../models';
import { seedCitationDirectories } from '../citations/seed';
import { setupStandardPlan } from './billingPlan';
import { syncAllIndexes } from './indexes';
import { DUMP_DIR, ReferenceDataResult, seedReferenceData } from './referenceData';
import { SuperAdminResult, ensureSuperAdmin } from './superAdmin';

// npm run setup:fresh (Phase 13b): everything an empty database needs, in order, idempotent:
// indexes → reference data → standard billing plan → citation directories → first super admin.
// Refuses to run on a database that already has organizations, unless force. PayPal setup
// (billing:paypal-setup) is separate: it calls PayPal.

export class DatabaseNotEmptyError extends Error {
	constructor(public organizations: number) {
		super(`The database already has ${organizations} organization(s). setup:fresh is for an empty database (use --force to run it anyway).`);
		this.name = 'DatabaseNotEmptyError';
	}
}

export interface SetupFreshResult {
	indexes: number;
	reference_data: ReferenceDataResult;
	billing_plan: { created: boolean; plan_id: string; prices: number };
	citations: { directories_created: number; categories_created: number };
	super_admin: SuperAdminResult;
}

export const setupFresh = async (opts: { force?: boolean; dumpDir?: string; citationDataDir?: string; superAdmin: { email: string | null | undefined; password?: string | null } }): Promise<SetupFreshResult> => {
	const organizations = await Organization.estimatedDocumentCount();
	if (organizations > 0 && !opts.force) throw new DatabaseNotEmptyError(organizations);
	const indexes = await syncAllIndexes();
	const reference_data = await seedReferenceData(opts.dumpDir ?? DUMP_DIR);
	const billing_plan = await setupStandardPlan();
	const seeded = await seedCitationDirectories({ dataDir: opts.citationDataDir, loadBusinessCategories: false });
	const super_admin = await ensureSuperAdmin(opts.superAdmin);
	return {
		indexes: indexes.length,
		reference_data,
		billing_plan,
		citations: { directories_created: seeded.directories.created ?? 0, categories_created: seeded.categories.created },
		super_admin,
	};
};
