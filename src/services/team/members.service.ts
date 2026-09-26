import httpStatus from 'http-status';
import { Types } from 'mongoose';
import logger from '../../configs/logger';
import { Client, IMembership, Membership, MembershipRole, User } from '../../models';
import { ApiError, apiErrorWithData } from '../../utils';
import { OrgContext } from '../org/context';

// Team members (Phase 11, owner only): change a role, remove a member. The owner can't be changed or
// removed (ownership transfer is out of scope).

const ownerProtected = () => apiErrorWithData(httpStatus.FORBIDDEN, "The organization owner can't be changed or removed.", { reason: 'owner_protected' });

const memberOf = async (ctx: OrgContext, userId: string) => {
	if (!Types.ObjectId.isValid(userId)) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid userId');
	const membership = await Membership.findOne({ organization_id: ctx.organization._id, user_id: userId, status: 'active' }).lean<IMembership>();
	if (!membership) throw new ApiError(httpStatus.NOT_FOUND, 'Member not found');
	if (membership.role === 'owner') throw ownerProtected();
	return membership;
};

export const changeRole = async (ctx: OrgContext, userId: string, input: { role: Exclude<MembershipRole, 'owner'>; client_ids?: string[] }) => {
	const membership = await memberOf(ctx, userId);
	let clientIds: Types.ObjectId[] = [];
	if (input.role === 'client_user') {
		if (ctx.organization.type !== 'agency') throw apiErrorWithData(httpStatus.FORBIDDEN, 'Client users are available to agency organizations only.', { reason: 'agency_only' });
		const ids = [...new Set(input.client_ids ?? [])];
		const clients = await Client.find({ _id: { $in: ids }, organization_id: ctx.organization._id, is_active: true }).select({ _id: 1 }).lean();
		if (!ids.length || clients.length !== ids.length) throw new ApiError(httpStatus.BAD_REQUEST, 'client_ids must list one or more clients of this organization.');
		clientIds = clients.map((c) => c._id as Types.ObjectId);
	}
	await Membership.updateOne({ _id: membership._id }, { $set: { role: input.role, client_ids: clientIds } });
	logger.info(`team: user ${userId} is now ${input.role} in organization ${String(ctx.organization._id)} (by ${ctx.userId})`);
	return { user_id: userId, role: input.role, client_ids: clientIds.map(String) };
};

export const removeMember = async (ctx: OrgContext, userId: string) => {
	const membership = await memberOf(ctx, userId);
	await Membership.updateOne({ _id: membership._id }, { $set: { status: 'removed' } });
	// Their default organization moves to another active membership, or none.
	const user = await User.findById(userId).select({ default_organization_id: 1 }).lean<{ default_organization_id?: Types.ObjectId | null }>();
	if (user && String(user.default_organization_id) === String(ctx.organization._id)) {
		const other = await Membership.findOne({ user_id: userId, status: 'active' }).sort({ created_at: 1, _id: 1 }).lean<IMembership>();
		await User.updateOne({ _id: userId }, { $set: { default_organization_id: other?.organization_id ?? null } });
	}
	logger.info(`team: user ${userId} removed from organization ${String(ctx.organization._id)} (by ${ctx.userId})`);
	return { removed: true, user_id: userId };
};
