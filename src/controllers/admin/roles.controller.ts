import config from '../../configs/config';
import { ADMIN_PERMISSIONS, PERMISSION_ROLES } from '../../configs/adminPermissions';
import { Role } from '../../models';
import { catchAsync, responseWrapper } from '../../utils';

// 13b: the admin roles, read-only (they are fixed: role ids 1 / 2 / 4 / 8 in src/configs/adminPermissions.ts).
// The admin panel uses it for the role picker when creating or editing an admin.

const ROLE_KEYS = ['superAdmin', 'admin', 'editor', 'sales'] as const;

export const listRoles = catchAsync(async (req, res) => {
	const stored = await Role.find({ role_id: { $in: ROLE_KEYS.map((k) => config.roles[k]) } }).select({ role_id: 1, name: 1, is_active: 1 }).lean<{ role_id: number; name: string; is_active: boolean }[]>();
	const byId = new Map(stored.map((r) => [r.role_id, r]));
	const roles = ROLE_KEYS.map((key) => {
		const roleId = config.roles[key];
		return {
			role_id: roleId,
			key,
			name: byId.get(roleId)?.name ?? key,
			active: byId.get(roleId)?.is_active ?? false,
			permissions: ADMIN_PERMISSIONS.filter((p) => PERMISSION_ROLES[p].includes(key)),
		};
	});
	return responseWrapper(res, roles);
});
