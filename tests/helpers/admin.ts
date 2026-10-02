import bcrypt from 'bcryptjs';
import config from '../../src/configs/config';
import { Admin, Role } from '../../src/models';
import { signAdminToken } from '../../src/services/admin/adminToken';

// Platform admins for route tests (Phase 16): the Role documents the permission check reads, and a
// signed admin session token per role.

export type AdminRoleKey = 'superAdmin' | 'admin' | 'editor' | 'sales';

export const ensureRoles = async (): Promise<void> => {
	for (const [name, role_id] of Object.entries({ superAdmin: config.roles.superAdmin, admin: config.roles.admin, editor: config.roles.editor, sales: config.roles.sales })) {
		await Role.updateOne({ role_id }, { $setOnInsert: { name, role_id, abbreviation: name.slice(0, 2) } }, { upsert: true });
	}
};

export const createAdmin = async (role: AdminRoleKey = 'editor', name = `${role} admin`): Promise<{ id: string; token: string }> => {
	await ensureRoles();
	const roleId = config.roles[role];
	const admin = await Admin.create({ name, email: `${role}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@admin.test`, role_id: roleId, password: bcrypt.hashSync('x-Password-1', 4) });
	return { id: String(admin._id), token: signAdminToken({ sub: String(admin._id), role_id: roleId, tv: 0 }) };
};
