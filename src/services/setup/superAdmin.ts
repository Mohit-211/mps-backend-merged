import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import config from '../../configs/config';
import { Admin } from '../../models';

// Fresh setup (Phase 13b): the first platform super admin (an Admin, role SUP_ADM_ROLE_ID). Idempotent:
// nothing happens when a super admin already exists. The password comes from the caller (e.g.
// SUPER_ADMIN_PASSWORD) or is generated; a generated one is returned once and never stored in clear.

export const MIN_ADMIN_PASSWORD = 12;

export interface SuperAdminResult {
	created: boolean;
	email: string | null;
	/** Only when generated here (show it once). */
	generated_password: string | null;
}

const generatePassword = (): string => crypto.randomBytes(18).toString('base64url');

export const ensureSuperAdmin = async (input: { email: string | null | undefined; password?: string | null; name?: string }): Promise<SuperAdminResult> => {
	const existing = await Admin.findOne({ role_id: config.roles.superAdmin, is_active: true }).select({ email: 1 }).lean<{ email: string }>();
	if (existing) return { created: false, email: existing.email, generated_password: null };
	const email = String(input.email ?? '').trim().toLowerCase();
	if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('A valid super admin email is required (SUPER_ADMIN_EMAIL or --email=).');
	if (input.password && input.password.length < MIN_ADMIN_PASSWORD) throw new Error(`The super admin password must have at least ${MIN_ADMIN_PASSWORD} characters.`);
	const password = input.password || generatePassword();
	await Admin.create({ name: input.name ?? 'Super Admin', email, role_id: config.roles.superAdmin, password: bcrypt.hashSync(password, 10) });
	return { created: true, email, generated_password: input.password ? null : password };
};
