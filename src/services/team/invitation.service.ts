import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import httpStatus from 'http-status';
import { Types } from 'mongoose';
import config from '../../configs/config';
import logger from '../../configs/logger';
import { userStatusTypes, userTypes } from '../../configs/constantTypes';
import { Client, IInvitation, IOrganization, IUser, Invitation, InvitationRole, Membership, Organization, Profile, User } from '../../models';
import { ApiError, apiErrorWithData } from '../../utils';
import { sendInvitationEmail } from '../common/email.service';
import { sessionFor } from '../auth/auth.service';
import { markVerified } from '../auth/emailVerification';
import { LIMITS, hit } from '../auth/rateLimit';
import { OrgContext } from '../org/context';
import { assertCanInvite } from '../org/limits';

// Team invitations (Phase 11). The owner invites by email (member, or client_user with clients in an
// agency). The link carries a 32-byte random token; only its SHA-256 is stored. Valid INVITATION_TTL_DAYS,
// single use. Accepting with a new email creates a verified account and logs in; accepting for an
// existing account adds the membership only (the link alone is not a login).

const DUPLICATE_KEY = 11000;

export interface InviteInput {
	email: string;
	role: InvitationRole;
	client_ids?: string[];
}

export interface Mailer {
	sendInvitation: (to: string, link: string, organizationName: string, role: string) => Promise<boolean>;
}

export interface InvitationDeps {
	mailer?: Mailer;
	now?: () => Date;
	env?: string;
}

export const hashToken = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');

/** j***@example.com */
export const maskEmail = (email: string): string => {
	const [local, domain] = email.split('@');
	return `${local.slice(0, 1)}***@${domain ?? ''}`;
};

export const invitationLink = (token: string): string => `${(config.auth.frontendUrl || 'http://localhost:3000').replace(/\/$/, '')}/invite?token=${token}`;

export type InvitationView = ReturnType<typeof view>;

const statusOf = (inv: Pick<IInvitation, 'status' | 'expires_at'>, now: Date): 'pending' | 'accepted' | 'revoked' | 'expired' =>
	inv.status === 'pending' && inv.expires_at.getTime() <= now.getTime() ? 'expired' : inv.status;

const view = (inv: IInvitation, now: Date) => ({
	invitation_id: String(inv._id),
	email: inv.email,
	role: inv.role,
	client_ids: (inv.client_ids ?? []).map(String),
	status: statusOf(inv, now),
	expires_at: inv.expires_at,
	invited_by: String(inv.invited_by),
	created_at: inv.created_at,
});

export const createInvitationService = (deps: InvitationDeps = {}) => {
	const mailer = deps.mailer ?? { sendInvitation: sendInvitationEmail };
	const now = deps.now ?? (() => new Date());
	const env = deps.env ?? config.essentials.env;

	const invite = async (ctx: OrgContext, input: InviteInput) => {
		const at = now();
		await hit(LIMITS.invitePerOrg, [String(ctx.organization._id)], at);
		const email = input.email.trim().toLowerCase();
		let clientIds: Types.ObjectId[] = [];
		if (input.role === 'client_user') {
			if (ctx.organization.type !== 'agency') throw apiErrorWithData(httpStatus.FORBIDDEN, 'Client users are available to agency organizations only.', { reason: 'agency_only' });
			const ids = [...new Set(input.client_ids ?? [])];
			const clients = await Client.find({ _id: { $in: ids }, organization_id: ctx.organization._id, is_active: true }).select({ _id: 1 }).lean();
			if (!ids.length || clients.length !== ids.length) throw new ApiError(httpStatus.BAD_REQUEST, 'client_ids must list one or more clients of this organization.');
			clientIds = clients.map((c) => c._id as Types.ObjectId);
		}
		const existing = await User.findOne({ email }).select({ _id: 1 }).lean();
		if (existing && (await Membership.exists({ organization_id: ctx.organization._id, user_id: existing._id, status: 'active' }))) {
			throw apiErrorWithData(httpStatus.CONFLICT, 'This person is already a member of the organization.', { reason: 'already_member' });
		}
		// Phase 13a: users are pooled per paid location (a re-issued invitation for the same email doesn't count twice).
		if (!(await Invitation.exists({ organization_id: ctx.organization._id, email, status: 'pending' }))) await assertCanInvite(ctx.organization);
		const token = crypto.randomBytes(32).toString('base64url');
		const fields = {
			role: input.role,
			client_ids: clientIds,
			token_hash: hashToken(token),
			expires_at: new Date(at.getTime() + config.auth.invitationTtlDays * 86_400_000),
			invited_by: new Types.ObjectId(ctx.userId),
		};
		let inv: IInvitation;
		try {
			// A pending invitation for the same email is re-issued: the old token stops working.
			inv = (await Invitation.findOneAndUpdate(
				{ organization_id: ctx.organization._id, email, status: 'pending' },
				{ $set: fields, $setOnInsert: { organization_id: ctx.organization._id, email, status: 'pending' } },
				{ upsert: true, new: true },
			)) as IInvitation;
		} catch (err) {
			if ((err as { code?: number }).code !== DUPLICATE_KEY) throw err;
			inv = (await Invitation.findOneAndUpdate({ organization_id: ctx.organization._id, email, status: 'pending' }, { $set: fields }, { new: true })) as IInvitation;
		}
		const link = invitationLink(token);
		let emailSent = false;
		if (env === 'development') {
			// Nothing is sent in development: the link is logged for local testing, with the email masked.
			logger.info(`invitation for ${maskEmail(email)}: ${link}`);
		} else {
			emailSent = await mailer.sendInvitation(email, link, ctx.organization.name, input.role);
		}
		logger.info(`team: invitation ${String(inv._id)} (${input.role}) created in organization ${String(ctx.organization._id)} by user ${ctx.userId}`);
		return { ...view(inv, at), email_sent: emailSent };
	};

	const list = async (ctx: OrgContext, status?: string) => {
		const at = now();
		const all = await Invitation.find({ organization_id: ctx.organization._id }).sort({ created_at: -1, _id: -1 }).limit(200).lean<IInvitation[]>();
		return all.map((i) => view(i, at)).filter((i) => !status || i.status === status);
	};

	const revoke = async (ctx: OrgContext, invitationId: string) => {
		if (!Types.ObjectId.isValid(invitationId)) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid invitationId');
		const updated = await Invitation.updateOne({ _id: invitationId, organization_id: ctx.organization._id, status: 'pending' }, { $set: { status: 'revoked' } });
		if (updated.matchedCount === 0) throw new ApiError(httpStatus.NOT_FOUND, 'No pending invitation with this id');
		return { revoked: true, invitation_id: invitationId };
	};

	const load = async (token: string) => {
		const inv = await Invitation.findOne({ token_hash: hashToken(token) }).lean<IInvitation>();
		if (!inv) throw new ApiError(httpStatus.NOT_FOUND, 'Invitation not found.');
		const status = statusOf(inv, now());
		if (status !== 'pending') throw apiErrorWithData(httpStatus.GONE, `This invitation is ${status}.`, { reason: status });
		return inv;
	};

	const inspect = async (token: string, ip: string) => {
		await hit(LIMITS.invitationPerIp, [ip], now());
		const inv = await load(token);
		const org = await Organization.findById(inv.organization_id).select({ name: 1, type: 1 }).lean<IOrganization>();
		return {
			organization: { name: org?.name ?? null, type: org?.type ?? null },
			email: inv.email,
			role: inv.role,
			status: 'pending' as const,
			expires_at: inv.expires_at,
			account_exists: Boolean(await User.exists({ email: inv.email })),
		};
	};

	const accept = async (input: { token: string; name?: string; password?: string }, ip: string) => {
		const at = now();
		await hit(LIMITS.invitationPerIp, [ip], at);
		const inv = await load(input.token);
		const user = await User.findOne({ email: inv.email });
		if (!user && (!input.name || !input.password)) {
			throw apiErrorWithData(httpStatus.BAD_REQUEST, 'Name and password are required to create your account.', { reason: 'account_details_required' });
		}
		// Single use: only one request can move it from pending to accepted.
		const claimed = await Invitation.findOneAndUpdate({ _id: inv._id, status: 'pending', expires_at: { $gt: at } }, { $set: { status: 'accepted', accepted_at: at } }, { new: true });
		if (!claimed) throw apiErrorWithData(httpStatus.GONE, 'This invitation was already used.', { reason: 'accepted' });

		let account: IUser;
		let created = false;
		if (user) {
			account = user;
			// Phase 8.1: accepting a link sent to this mailbox verifies an account that wasn't yet.
			if (!user.email_verified_at) await markVerified(user._id, at);
		} else {
			account = await User.create({
				email: inv.email,
				password: bcrypt.hashSync(input.password as string, 10),
				role_id: config.roles.user,
				user_type: inv.role === 'client_user' ? userTypes.client : userTypes.employee,
				// The link was delivered to this mailbox, so the email counts as verified.
				status: userStatusTypes.ACCEPTED,
				email_verified_at: at,
			});
			await Profile.create({ user_id: account._id, name: input.name });
			created = true;
		}
		await Membership.updateOne(
			{ organization_id: inv.organization_id, user_id: account._id },
			{ $set: { role: inv.role, client_ids: inv.client_ids ?? [], status: 'active', created_by: inv.invited_by } },
			{ upsert: true },
		);
		await Invitation.updateOne({ _id: inv._id }, { $set: { accepted_by: account._id } });
		await User.updateOne(
			{ _id: account._id, $or: [{ default_organization_id: null }, { default_organization_id: { $exists: false } }] },
			{ $set: { default_organization_id: inv.organization_id } },
		);
		logger.info(`team: invitation ${String(inv._id)} accepted by user ${String(account._id)} (new_account=${created})`);
		if (!created) return { accepted: true, organization_id: String(inv.organization_id), login_required: true };
		const fresh = (await User.findById(account._id)) as IUser;
		return { accepted: true, organization_id: String(inv.organization_id), login_required: false, ...(await sessionFor(fresh)) };
	};

	return { invite, list, revoke, inspect, accept };
};

export const invitationService = createInvitationService();
