import httpStatus from 'http-status';
import * as adminAuthService from '../../services/admin/adminAuth.service';
import { AuditActor } from '../../services/billing/audit';
import { catchAsync, responseWrapper } from '../../utils';

// 13b: admin sign-in, password links and admin accounts. Validated input is on res.locals.input;
// validateAdminJWTToken puts the signed-in admin on res.locals.admin.

const ipOf = (req: { ip?: string }) => req.ip ?? 'unknown';
const actorOf = (res: { locals: Record<string, unknown> }): AuditActor => {
	const admin = res.locals.admin as { id: string; name: string | null };
	return { id: admin.id, name: admin.name };
};

export const login = catchAsync(async (req, res) => responseWrapper(res, await adminAuthService.login(res.locals.input, ipOf(req)), 'Signed in.'));
export const forgotPassword = catchAsync(async (req, res) =>
	responseWrapper(res, await adminAuthService.forgotPassword(res.locals.input, ipOf(req)), 'If this email belongs to an administrator, a reset link was sent.'),
);
export const resetPassword = catchAsync(async (req, res) =>
	responseWrapper(res, await adminAuthService.resetPassword(res.locals.input, ipOf(req)), 'Password set. Please sign in.'),
);
export const changePassword = catchAsync(async (req, res) =>
	responseWrapper(res, await adminAuthService.changePassword(actorOf(res).id, res.locals.input), 'Password changed. Other sessions were signed out.'),
);
export const me = catchAsync(async (req, res) => responseWrapper(res, await adminAuthService.me(actorOf(res).id)));

export const listAdmins = catchAsync(async (req, res) => responseWrapper(res, await adminAuthService.listAdmins(res.locals.input)));
export const getAdmin = catchAsync(async (req, res) => responseWrapper(res, await adminAuthService.getAdmin(req.params.adminId)));
export const createAdmin = catchAsync(async (req, res) =>
	responseWrapper(res, await adminAuthService.createAdmin(actorOf(res), res.locals.input), 'Admin created. A link to set the password was emailed.', httpStatus.CREATED),
);
export const updateAdmin = catchAsync(async (req, res) =>
	responseWrapper(res, await adminAuthService.updateAdmin(actorOf(res), req.params.adminId, res.locals.input), 'Admin updated.'),
);
export const resendPasswordLink = catchAsync(async (req, res) =>
	responseWrapper(res, await adminAuthService.resendPasswordLink(actorOf(res), req.params.adminId), 'Password link sent.'),
);
