import bcrypt from 'bcryptjs';
import httpStatus from 'http-status';
import { Types } from 'mongoose';
import logger from '../../configs/logger';
import { tokenTypes, userStatusTypes } from '../../configs/constantTypes';
import { AuthLink, IUser, IUserToken, Membership, Profile, User, UserLoginTiming, UserToken } from '../../models';
import { ApiError, apiErrorWithData } from '../../utils';
import { generateAuthTokens, revokeUserSessions, verifyToken } from '../common/token.service';
import { bindingService } from '../gbp/binding.service';
import { tokenStore } from '../gbp/tokenStore';
import { listMemberships, resolveOrgContext } from '../org/context';

// Session and account endpoints of the rebuilt app (Phase 13b), replacing the legacy /user/auth
// refresh-auth / logout / reset-password / deactivate and /user/profile. Logs carry user ids only.

type UserId = Types.ObjectId | string;
const BLOCKED = [userStatusTypes.REJECTED, userStatusTypes.BLOCKED, userStatusTypes.SUSPENDED, userStatusTypes.DEACTIVATED, userStatusTypes.INACTIVE];

const sessionEnded = () => new ApiError(httpStatus.UNAUTHORIZED, 'Your session has ended. Please log in again.');
const wrongPassword = () => apiErrorWithData(httpStatus.BAD_REQUEST, 'The password is not correct.', { reason: 'wrong_password' });

const usableUser = async (userId: UserId): Promise<IUser> => {
	const user = await User.findById(userId);
	if (!user || !user.is_active || BLOCKED.includes(user.status) || !user.email_verified_at) throw sessionEnded();
	return user;
};

/** The stored refresh token row (401 when unknown, expired or revoked). */
const refreshRow = async (refreshToken: string): Promise<IUserToken> => {
	try {
		return (await verifyToken(refreshToken, tokenTypes.REFRESH)) as IUserToken;
	} catch {
		throw sessionEnded();
	}
};

export const createSessionService = (deps: { now?: () => Date } = {}) => {
	const now = deps.now ?? (() => new Date());

	/** A new access + refresh token; the used refresh token stops working (rotation). */
	const refresh = async (refreshToken: string) => {
		const row = await refreshRow(refreshToken);
		const user = await usableUser(row.user_id as unknown as Types.ObjectId);
		const tokens = await generateAuthTokens(user);
		await UserToken.deleteOne({ _id: row._id });
		await UserLoginTiming.updateOne({ token_id: row._id }, { $set: { token_id: tokens.refresh.id } });
		delete tokens.refresh.id;
		return { tokens };
	};

	/** Ends this session (its refresh token); records the logout time. */
	const logout = async (refreshToken: string) => {
		const row = await refreshRow(refreshToken);
		await UserToken.deleteOne({ _id: row._id });
		await UserLoginTiming.updateOne({ token_id: row._id }, { $set: { logout_time_utc: now(), token_id: null } });
		return { logged_out: true };
	};

	/** Changes the password and ends every other session; returns fresh tokens for this one. */
	const changePassword = async (userId: UserId, input: { current_password: string; new_password: string }) => {
		const user = await usableUser(userId);
		if (!(await bcrypt.compare(input.current_password, user.password))) throw wrongPassword();
		if (await bcrypt.compare(input.new_password, user.password)) {
			throw apiErrorWithData(httpStatus.BAD_REQUEST, 'The new password must be different.', { reason: 'same_password' });
		}
		user.password = bcrypt.hashSync(input.new_password, 10);
		await user.save();
		await revokeUserSessions(user._id);
		const tokens = await generateAuthTokens((await User.findById(user._id)) as IUser);
		delete tokens.refresh.id;
		logger.info(`auth: user ${String(user._id)} changed their password (other sessions ended)`);
		return { tokens };
	};

	const me = async (userId: UserId) => {
		const user = await usableUser(userId);
		const profile = await Profile.findOne({ user_id: user._id }).select({ name: 1, mobile: 1 }).lean<{ name?: string; mobile?: string }>();
		const memberships = await listMemberships(user._id);
		const current = memberships.length ? String((await resolveOrgContext(user._id)).organization._id) : null;
		const last = await UserLoginTiming.findOne({ user_id: user._id }).sort({ login_time_utc: -1 }).select({ login_time_utc: 1 }).lean<{ login_time_utc?: Date }>();
		return {
			id: String(user._id),
			email: user.email,
			name: profile?.name ?? null,
			mobile: profile?.mobile ?? null,
			user_type: user.user_type ?? null,
			email_verified_at: user.email_verified_at ?? null,
			created_at: user.created_at,
			last_login_at: last?.login_time_utc ?? null,
			organizations: memberships.map((m) => ({ organization_id: String(m.organization._id), name: m.organization.name, type: m.organization.type, role: m.membership.role })),
			current_organization_id: current,
		};
	};

	const updateMe = async (userId: UserId, input: { name?: string; mobile?: string | null }) => {
		const user = await usableUser(userId);
		const set: Record<string, unknown> = {};
		if (input.name !== undefined) set.name = input.name;
		if (input.mobile !== undefined) set.mobile = input.mobile || null;
		await Profile.updateOne({ user_id: user._id }, { $set: set }, { upsert: true });
		return me(user._id);
	};

	/**
	 * Deletes the account (with the password): every Google connection is disconnected (revoked at Google,
	 * its profiles unbound, their jobs cancelled), memberships end, every session is revoked.
	 */
	const deactivate = async (userId: UserId, input: { password: string }) => {
		const user = await usableUser(userId);
		if (!(await bcrypt.compare(input.password, user.password))) throw wrongPassword();
		for (const conn of await tokenStore.listConnections(user._id, tokenTypes.GBP)) {
			await bindingService.disconnect(user._id, conn.googleSub).catch(() => undefined);
		}
		await Membership.updateMany({ user_id: user._id }, { $set: { status: 'removed' } });
		await revokeUserSessions(user._id);
		await Promise.all([
			Profile.deleteOne({ user_id: user._id }),
			UserToken.deleteMany({ user_id: user._id }),
			UserLoginTiming.deleteMany({ user_id: user._id }),
			AuthLink.deleteMany({ subject_kind: 'user', subject_id: user._id }),
		]);
		await User.deleteOne({ _id: user._id });
		logger.info(`auth: user ${String(user._id)} deleted their account`);
		return { deleted: true };
	};

	return { refresh, logout, changePassword, me, updateMe, deactivate };
};

export const sessionService = createSessionService();
