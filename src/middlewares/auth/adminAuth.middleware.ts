/** @format */

import httpStatus from "http-status";
import { AdminPermission, permissionsFor } from "../../configs/adminPermissions";
import { AdminTokenClaims, verifyAdminToken } from "../../services/admin/adminToken";

import {
	responseWrapper,
	apiErrorWithData,
	catchAsync,
	isValidMongoObjectId,
} from "../../utils";
import { Admin, IAdmin, Role } from "../../models";

/**
 * Phase 10 (AUDIT S19, S1): admin session tokens only (adminToken.ts: ADMIN_JWT_SECRET, HS256,
 * audience mps-admin, purpose session). The admin must exist, be active, and still have the token's
 * token_version and role; the role must exist and be active. Sets res.locals.admin (with permissions)
 * and, for the legacy admin controllers, req.body.user.
 */
export const validateAdminJWTToken = catchAsync(async (req, res, next) => {
	const unauthorized = () => responseWrapper(res, "", "Unauthorized: please sign in as an administrator.", httpStatus.UNAUTHORIZED);
	const authHeader = req.headers["authorization"];
	const token = typeof authHeader === "string" && authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
	if (!token) return unauthorized();
	let claims: AdminTokenClaims;
	try {
		claims = verifyAdminToken(token, "session");
	} catch {
		return unauthorized();
	}
	if (!isValidMongoObjectId(claims.sub)) return unauthorized();
	const admin = await Admin.findOne({ _id: claims.sub, is_active: true }).select({ name: 1, email: 1, role_id: 1, token_version: 1 }).lean<IAdmin>();
	if (!admin || (admin.token_version ?? 0) !== claims.tv || admin.role_id !== claims.role_id) return unauthorized();
	const role = await Role.findOne({ role_id: admin.role_id, is_active: true }).select({ name: 1 }).lean<{ name: string }>();
	if (!role) return unauthorized();
	const permissions = permissionsFor(admin.role_id);
	res.locals.admin = { id: String(admin._id), name: admin.name ?? null, email: admin.email, role_id: admin.role_id, role_name: role.name, permissions };
	req.body = req.body ?? {};
	req.body.user = {
		_id: admin._id,
		name: admin.name,
		email: admin.email,
		role_id: admin.role_id,
		role_name: role.name,
	};
	req.body.ip_address = req.ip;
	next();
});

/** Phase 10: after validateAdminJWTToken; 403 { reason: 'forbidden' } without the permission. */
export const requireAdminPermission = (permission: AdminPermission) =>
	catchAsync(async (req, res, next) => {
		const admin = res.locals.admin as { permissions?: AdminPermission[] } | undefined;
		if (!admin?.permissions?.includes(permission)) {
			throw apiErrorWithData(httpStatus.FORBIDDEN, "Your admin role doesn't allow this.", { reason: "forbidden", permission });
		}
		next();
	});

/** Both guards in one (router.use(...adminOnly('platform.read'))). */
export const adminOnly = (permission: AdminPermission) => [validateAdminJWTToken, requireAdminPermission(permission)];
