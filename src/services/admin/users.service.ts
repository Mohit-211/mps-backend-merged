import httpStatus from 'http-status';
import { Types } from 'mongoose';
import { tokenTypes, userStatusTypes } from '../../configs/constantTypes';
import { IMembership, IUser, Membership, Organization, Profile, User, UserLoginTiming } from '../../models';
import { apiErrorWithData } from '../../utils';
import { authService } from '../auth/auth.service';
import { markVerified } from '../auth/emailVerification';
import { audit, AuditActor } from '../billing/audit';
import { revokeUserSessions } from '../common/token.service';
import { tokenStore } from '../gbp/tokenStore';

// Admin panel: users (Phase 13b), behind platform.read / platform.write. Every change is audit-logged.

const oid = (id: string) => (Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null);
const notFound = () => apiErrorWithData(httpStatus.NOT_FOUND, 'User not found.', { reason: 'not_found' });
const esc = (s: string) => s.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const loadUser = async (userId: string): Promise<IUser> => {
	const id = oid(userId);
	const u = id ? await User.findById(id).lean<IUser>() : null;
	if (!u) throw notFound();
	return u;
};

const summary = (u: IUser, name: string | null, lastLogin: Date | null, organizations: number) => ({
	id: String(u._id),
	email: u.email,
	name,
	user_type: u.user_type ?? null,
	status: u.status,
	disabled: u.status === userStatusTypes.BLOCKED,
	email_verified_at: u.email_verified_at ?? null,
	created_at: u.created_at,
	last_login_at: lastLogin,
	organizations,
});

export const listUsers = async (f: { q?: string; status?: 'active' | 'disabled' | 'unverified'; page: number; limit: number }) => {
	const q: Record<string, unknown> = {};
	if (f.q) {
		const byName = await Profile.find({ name: { $regex: esc(f.q), $options: 'i' } }).select({ user_id: 1 }).limit(200).lean<{ user_id: Types.ObjectId }[]>();
		q.$or = [{ email: { $regex: esc(f.q), $options: 'i' } }, { _id: { $in: byName.map((p) => p.user_id) } }];
	}
	if (f.status === 'disabled') q.status = userStatusTypes.BLOCKED;
	if (f.status === 'active') Object.assign(q, { status: userStatusTypes.ACCEPTED, email_verified_at: { $ne: null } });
	if (f.status === 'unverified') q.email_verified_at = null;
	const [rows, total] = await Promise.all([User.find(q).sort({ created_at: -1 }).skip((f.page - 1) * f.limit).limit(f.limit).lean<IUser[]>(), User.countDocuments(q)]);
	const ids = rows.map((u) => u._id);
	const [profiles, logins, memberships] = await Promise.all([
		Profile.find({ user_id: { $in: ids } }).select({ user_id: 1, name: 1 }).lean<{ user_id: Types.ObjectId; name?: string }[]>(),
		UserLoginTiming.aggregate<{ _id: Types.ObjectId; last: Date }>([{ $match: { user_id: { $in: ids } } }, { $group: { _id: '$user_id', last: { $max: '$login_time_utc' } } }]),
		Membership.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { user_id: { $in: ids }, status: 'active' } }, { $group: { _id: '$user_id', n: { $sum: 1 } } }]),
	]);
	const name = new Map(profiles.map((p) => [String(p.user_id), p.name ?? null]));
	const last = new Map(logins.map((l) => [String(l._id), l.last]));
	const orgs = new Map(memberships.map((m) => [String(m._id), m.n]));
	return { users: rows.map((u) => summary(u, name.get(String(u._id)) ?? null, last.get(String(u._id)) ?? null, orgs.get(String(u._id)) ?? 0)), page: f.page, limit: f.limit, total };
};

export const getUser = async (userId: string) => {
	const u = await loadUser(userId);
	const [profile, memberships, logins, connections] = await Promise.all([
		Profile.findOne({ user_id: u._id }).select({ name: 1, mobile: 1 }).lean<{ name?: string; mobile?: string }>(),
		Membership.find({ user_id: u._id }).lean<IMembership[]>(),
		UserLoginTiming.find({ user_id: u._id }).sort({ login_time_utc: -1 }).limit(10).select({ login_time_utc: 1, logout_time_utc: 1, ip_address: 1 }).lean<{ login_time_utc?: Date; logout_time_utc?: Date; ip_address?: string }[]>(),
		tokenStore.listConnections(u._id, tokenTypes.GBP),
	]);
	const orgs = await Organization.find({ _id: { $in: memberships.map((m) => m.organization_id) } }).select({ name: 1, type: 1 }).lean<{ _id: Types.ObjectId; name: string; type: string }[]>();
	const orgById = new Map(orgs.map((o) => [String(o._id), o]));
	return {
		...summary(u, profile?.name ?? null, logins[0]?.login_time_utc ?? null, memberships.filter((m) => m.status === 'active').length),
		mobile: profile?.mobile ?? null,
		memberships: memberships.map((m) => ({
			organization_id: String(m.organization_id),
			organization: orgById.get(String(m.organization_id))?.name ?? null,
			type: orgById.get(String(m.organization_id))?.type ?? null,
			role: m.role,
			status: m.status,
		})),
		recent_logins: logins.map((l) => ({ at: l.login_time_utc ?? null, logged_out_at: l.logout_time_utc ?? null, ip: l.ip_address ?? null })),
		google_connections: connections.map((c) => ({ google_email: c.googleEmail, status: c.status })),
	};
};

/** Blocks sign-in and ends every session. */
export const disableUser = async (actor: AuditActor, userId: string, reason: string) => {
	const u = await loadUser(userId);
	await User.updateOne({ _id: u._id }, { $set: { status: userStatusTypes.BLOCKED } });
	await revokeUserSessions(u._id);
	await audit(actor, { action: 'admin.user.disable', target: `user:${userId}`, before: u.status, after: userStatusTypes.BLOCKED, note: reason });
	return getUser(userId);
};

export const enableUser = async (actor: AuditActor, userId: string) => {
	const u = await loadUser(userId);
	const status = u.email_verified_at ? userStatusTypes.ACCEPTED : userStatusTypes.PENDING;
	await User.updateOne({ _id: u._id }, { $set: { status } });
	await audit(actor, { action: 'admin.user.enable', target: `user:${userId}`, before: u.status, after: status });
	return getUser(userId);
};

/** Ends every session (the user signs in again). */
export const forceLogout = async (actor: AuditActor, userId: string) => {
	const u = await loadUser(userId);
	await revokeUserSessions(u._id);
	await audit(actor, { action: 'admin.user.logout', target: `user:${userId}` });
	return { logged_out: true };
};

export const resendVerification = async (actor: AuditActor, userId: string) => {
	const u = await loadUser(userId);
	if (u.email_verified_at) throw apiErrorWithData(httpStatus.CONFLICT, 'The email is already verified.', { reason: 'already_verified' });
	await authService.resendVerification({ email: u.email }, { ip: `admin:${actor.id}` });
	await audit(actor, { action: 'admin.user.resend_verification', target: `user:${userId}` });
	return { email_verification: 'sent_if_pending' };
};

export const markUserVerified = async (actor: AuditActor, userId: string) => {
	const u = await loadUser(userId);
	if (u.email_verified_at) throw apiErrorWithData(httpStatus.CONFLICT, 'The email is already verified.', { reason: 'already_verified' });
	await markVerified(u._id);
	await audit(actor, { action: 'admin.user.verify', target: `user:${userId}` });
	return getUser(userId);
};
