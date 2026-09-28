import config from './config';

// Platform admin permissions (Phase 10). Roles are the existing Role collection's role_id values
// (SUP_ADM_ROLE_ID, ADM_ROLE_ID, EDTR_ROLE_ID). Routes ask for a permission, never a role, so the
// matrix can change here without touching routes. Phase 16's citation admin uses citations.view (read)
// and citations.manage (write); they are separate so a read-only role can be added later. Phase 13a's
// billing admin uses billing.read and billing.manage (super admin, admin).

export const ADMIN_PERMISSIONS = ['admins.manage', 'platform.read', 'platform.write', 'content.manage', 'citations.view', 'citations.manage', 'billing.read', 'billing.manage', 'support.read', 'support.manage'] as const;
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

type RoleKey = 'superAdmin' | 'admin' | 'editor';

/** Which roles hold each permission (the super admin holds every one). */
export const PERMISSION_ROLES: Record<AdminPermission, RoleKey[]> = {
	'admins.manage': ['superAdmin'],
	'platform.read': ['superAdmin', 'admin'],
	'platform.write': ['superAdmin', 'admin'],
	'content.manage': ['superAdmin', 'admin', 'editor'],
	'citations.view': ['superAdmin', 'admin', 'editor'],
	'citations.manage': ['superAdmin', 'admin', 'editor'],
	'billing.read': ['superAdmin', 'admin'],
	'billing.manage': ['superAdmin', 'admin'],
	'support.read': ['superAdmin', 'admin', 'editor'],
	'support.manage': ['superAdmin', 'admin', 'editor'],
};

export const permissionsFor = (roleId: number | null | undefined): AdminPermission[] => {
	if (roleId === null || roleId === undefined) return [];
	const keys = (Object.keys(config.roles) as (keyof typeof config.roles)[]).filter((k) => config.roles[k] === roleId);
	return ADMIN_PERMISSIONS.filter((p) => PERMISSION_ROLES[p].some((r) => keys.includes(r)));
};
