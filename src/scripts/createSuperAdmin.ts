/*
 * Phase 13b: creates the first platform super admin if none exists (idempotent). Email from --email= or
 * SUPER_ADMIN_EMAIL; password from SUPER_ADMIN_PASSWORD (≥ 12 characters) or generated and shown once.
 * Further admins are created in the admin panel (POST /api/v1/admin/auth/register).
 *
 *   npm run admin:create-super -- [--email=owner@example.com] [--confirm]
 */
import config from '../configs/config';
import { ensureSuperAdmin } from '../services/setup/superAdmin';
import { argValue, runWithDb } from './lib/withDb';

runWithDb('admin:create-super', async () => {
	const r = await ensureSuperAdmin({ email: argValue('email') ?? config.superAdmin.email, password: config.superAdmin.password || null });
	if (!r.created) process.stdout.write(`A super admin already exists (${r.email}); nothing changed.\n`);
	else process.stdout.write(`Super admin created: ${r.email}\n${r.generated_password ? `PASSWORD (shown once, store it now): ${r.generated_password}\n` : 'Password: SUPER_ADMIN_PASSWORD.\n'}`);
	return 0;
});
