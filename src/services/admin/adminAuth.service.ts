import bcrypt from 'bcryptjs';
import httpStatus from 'http-status';
import { Types } from 'mongoose';
import config from '../../configs/config';
import logger from '../../configs/logger';
import { AdminPermission, permissionsFor } from '../../configs/adminPermissions';
import { Admin, IAdmin, Role } from '../../models';
import { ApiError, apiErrorWithData } from '../../utils';
import { audit, AuditActor } from '../billing/audit';
import { sendAdminPasswordLinkEmail } from '../common/email.service';
import { adminLinkUrl, claimLink, findLink, issueLink, linkError, passwordResetExpiry, passwordsDoNotMatch } from '../auth/links';
import { LIMITS, hit } from '../auth/rateLimit';
import { signAdminToken } from './adminToken';

// Platform admin sign-in and accounts (Phase 10; rebuilt in 13b: no OTP codes anywhere).
// - Sign-in: email + password → a 12 h admin session token (adminToken.ts), rate-limited per email + IP.
// - Forgot password: a link to ADMIN_FRONTEND_URL/reset-password?token=… (PASSWORD_RESET_TTL_MINUTES, single
//   use, a newer link replaces older ones), the same answer whether or not the email is an admin.
// - A new admin gets no password: a set-password link (ADMIN_SET_PASSWORD_TTL_HOURS) to the same page.
// - token_version is incremented on every password change or reset, role or email change and deactivation.
// - Admins are deactivated, never deleted (audit entries keep their author); every account change is audit-logged.

type Id = Types.ObjectId | string;
const ROLE_KEYS = ['superAdmin', 'admin', 'editor', 'sales'] as const;

const invalidCredentials = () => new ApiError(httpStatus.BAD_REQUEST, 'Invalid email or password.');
const notFound = () => new ApiError(httpStatus.NOT_FOUND, 'Admin not found.');

const roleName = async (roleId: number | null | undefined): Promise<string | null> =>
	roleId === null || roleId === undefined ? null : ((await Role.findOne({ role_id: roleId }).select({ name: 1 }).lean<{ name: string }>())?.name ?? null);

export interface AdminView {
	id: string;
	name: string | null;
	email: string;
	role_id: number | null;
	role_name: string | null;
	permissions: AdminPermission[];
	is_active: boolean;
	password_set: boolean;
	last_login_at: Date | null;
	created_at: Date;
}

const view = async (admin: IAdmin): Promise<AdminView> => ({
	id: String(admin._id),
	name: admin.name ?? null,
	email: admin.email,
	role_id: admin.role_id ?? null,
	role_name: await roleName(admin.role_id),
	permissions: permissionsFor(admin.role_id),
	is_active: admin.is_active,
	password_set: Boolean(admin.password),
	last_login_at: admin.last_login_at ?? null,
	created_at: admin.created_at,
});

const sessionFor = (admin: Pick<IAdmin, '_id' | 'role_id' | 'token_version'>) =>
	signAdminToken({ sub: String(admin._id), role_id: admin.role_id as number, tv: admin.token_version ?? 0 });

/** One of the fixed admin roles (super admin, admin, editor, sales) that exists and is active. */
const assertAssignableRole = async (roleId: number): Promise<void> => {
	const fixed = ROLE_KEYS.map((k) => config.roles[k]);
	if (!fixed.includes(roleId) || !(await Role.exists({ role_id: roleId, is_active: true }))) {
		throw apiErrorWithData(httpStatus.BAD_REQUEST, 'Unknown admin role.', { reason: 'invalid_role', roles: fixed });
	}
};

const isLastActiveSuperAdmin = async (admin: IAdmin): Promise<boolean> =>
	admin.role_id === config.roles.superAdmin && admin.is_active && (await Admin.countDocuments({ role_id: config.roles.superAdmin, is_active: true })) <= 1;

// ---- Sign-in and passwords ----

export const login = async (input: { email: string; password: string }, ip: string, now: Date = new Date()) => {
	await hit(LIMITS.adminLoginPerEmailIp, [input.email, ip], now);
	const admin = await Admin.findOne({ email: input.email, is_active: true });
	if (!admin?.password || !(await bcrypt.compare(input.password, admin.password))) throw invalidCredentials();
	if (!(await Role.exists({ role_id: admin.role_id, is_active: true }))) throw invalidCredentials();
	admin.last_login_at = now;
	await admin.save();
	logger.info(`admin: ${String(admin._id)} signed in`);
	return { admin: await view(admin), token: sessionFor(admin) };
};

/** Emails a reset link to an active admin. Always the same answer (no admin-email enumeration). */
export const forgotPassword = async (input: { email: string }, ip: string, now: Date = new Date()) => {
	await hit(LIMITS.adminForgotPerIp, [ip], now);
	await hit(LIMITS.adminForgotPerEmail, [input.email], now);
	const admin = await Admin.findOne({ email: input.email, is_active: true });
	if (admin) {
		const token = await issueLink('admin', admin._id, 'reset_password', passwordResetExpiry(now));
		await sendAdminPasswordLinkEmail(admin.email, adminLinkUrl('reset-password', token), 'reset');
		logger.info(`admin: password reset link issued for ${String(admin._id)}`);
	}
	return { reset: 'sent_if_account_exists' };
};

/** Sets a password with a reset link or a new admin's set-password link; every admin session of that account ends. */
export const resetPassword = async (input: { token: string; password: string; confirm_password: string }, ip: string, now: Date = new Date()) => {
	await hit(LIMITS.adminResetPerIp, [ip], now);
	if (input.password !== input.confirm_password) throw passwordsDoNotMatch();
	const found = await findLink(['reset_password', 'set_password'], input.token, now);
	if ('reason' in found) throw linkError(found.reason);
	if (found.link.subject_kind !== 'admin') throw linkError('link_invalid');
	const admin = await Admin.findOne({ _id: found.link.subject_id, is_active: true });
	if (!admin) throw linkError('link_invalid');
	if (!(await claimLink(found.link, now))) throw linkError('link_used');
	admin.password = bcrypt.hashSync(input.password, 10);
	admin.token_version = (admin.token_version ?? 0) + 1;
	await admin.save();
	logger.info(`admin: ${String(admin._id)} set a password (${found.link.purpose})`);
	return { reset: true };
};

/** The signed-in admin changes their password; other sessions end, this one continues with the returned token. */
export const changePassword = async (adminId: Id, input: { current_password: string; new_password: string; confirm_password: string }) => {
	if (input.new_password !== input.confirm_password) throw passwordsDoNotMatch();
	const admin = await Admin.findOne({ _id: adminId, is_active: true });
	if (!admin?.password || !(await bcrypt.compare(input.current_password, admin.password))) {
		throw apiErrorWithData(httpStatus.BAD_REQUEST, 'The current password is not correct.', { reason: 'wrong_password' });
	}
	admin.password = bcrypt.hashSync(input.new_password, 10);
	admin.token_version = (admin.token_version ?? 0) + 1;
	await admin.save();
	return { changed: true, token: sessionFor(admin) };
};

export const me = async (adminId: Id): Promise<AdminView> => {
	const admin = await Admin.findOne({ _id: adminId, is_active: true });
	if (!admin) throw notFound();
	return view(admin);
};

// ---- Admin accounts (admins.manage) ----

const sendPasswordLink = async (admin: IAdmin, now: Date): Promise<boolean> => {
	const purpose = admin.password ? 'reset_password' : 'set_password';
	const expires = purpose === 'set_password' ? new Date(now.getTime() + config.auth.adminSetPasswordTtlHours * 3_600_000) : passwordResetExpiry(now);
	const token = await issueLink('admin', admin._id, purpose, expires);
	return sendAdminPasswordLinkEmail(admin.email, adminLinkUrl('reset-password', token), purpose === 'set_password' ? 'welcome' : 'reset');
};

export const listAdmins = async (query: { active?: boolean }) => {
	const filter = query.active === undefined ? {} : { is_active: query.active };
	const admins = await Admin.find(filter).sort({ created_at: 1 });
	return Promise.all(admins.map(view));
};

export const getAdmin = async (adminId: Id): Promise<AdminView> => {
	const admin = await Admin.findById(adminId);
	if (!admin) throw notFound();
	return view(admin);
};

/** Creates an admin without a password and emails the set-password link. */
export const createAdmin = async (actor: AuditActor, input: { name: string; email: string; role_id: number }, now: Date = new Date()) => {
	await assertAssignableRole(input.role_id);
	if (await Admin.exists({ email: input.email })) throw apiErrorWithData(httpStatus.CONFLICT, 'An admin with this email already exists.', { reason: 'email_taken' });
	const admin = await Admin.create({ name: input.name, email: input.email, role_id: input.role_id, password: null, created_by: new Types.ObjectId(actor.id) });
	const sent = await sendPasswordLink(admin, now);
	await audit(actor, { action: 'admin.create', target: String(admin._id), after: { name: input.name, email: input.email, role_id: input.role_id } }, now);
	return { ...(await view(admin)), password_link_sent: sent };
};

/** Name, email, role, active. Not your own role or active flag; never the last active super admin's role or activity. */
export const updateAdmin = async (actor: AuditActor, adminId: Id, input: { name?: string; email?: string; role_id?: number; is_active?: boolean }, now: Date = new Date()) => {
	const admin = await Admin.findById(adminId);
	if (!admin) throw notFound();
	const self = String(admin._id) === actor.id;
	const before = { name: admin.name ?? null, email: admin.email, role_id: admin.role_id ?? null, is_active: admin.is_active };
	let revoke = false;
	if (input.role_id !== undefined && input.role_id !== admin.role_id) {
		if (self) throw apiErrorWithData(httpStatus.FORBIDDEN, "You can't change your own role.", { reason: 'own_role' });
		await assertAssignableRole(input.role_id);
		if (await isLastActiveSuperAdmin(admin)) throw apiErrorWithData(httpStatus.FORBIDDEN, 'The last super admin must stay a super admin.', { reason: 'last_super_admin' });
		admin.role_id = input.role_id;
		revoke = true;
	}
	if (input.is_active !== undefined && input.is_active !== admin.is_active) {
		if (self) throw apiErrorWithData(httpStatus.FORBIDDEN, "You can't deactivate your own account.", { reason: 'own_account' });
		if (!input.is_active && (await isLastActiveSuperAdmin(admin))) throw apiErrorWithData(httpStatus.FORBIDDEN, "The last super admin can't be deactivated.", { reason: 'last_super_admin' });
		admin.is_active = input.is_active;
		revoke = true;
	}
	if (input.email !== undefined && input.email !== admin.email) {
		if (await Admin.exists({ email: input.email, _id: { $ne: admin._id } })) throw apiErrorWithData(httpStatus.CONFLICT, 'An admin with this email already exists.', { reason: 'email_taken' });
		admin.email = input.email;
		revoke = true;
	}
	if (input.name !== undefined) admin.name = input.name;
	if (revoke) admin.token_version = (admin.token_version ?? 0) + 1;
	await admin.save();
	const after = { name: admin.name ?? null, email: admin.email, role_id: admin.role_id ?? null, is_active: admin.is_active };
	await audit(actor, { action: 'admin.update', target: String(admin._id), before, after }, now);
	return view(admin);
};

/** Emails a new set-password link (no password yet) or reset link; older links stop working. */
export const resendPasswordLink = async (actor: AuditActor, adminId: Id, now: Date = new Date()) => {
	const admin = await Admin.findOne({ _id: adminId, is_active: true });
	if (!admin) throw notFound();
	const sent = await sendPasswordLink(admin, now);
	await audit(actor, { action: 'admin.password_link', target: String(admin._id), note: admin.password ? 'reset' : 'set' }, now);
	return { password_link_sent: sent, purpose: admin.password ? 'reset_password' : 'set_password' };
};
