import { IMembership, IOrganization, IProfile, IUser, Membership, Organization, Profile, User } from '../../models';
import { OrgContext, listMemberships } from './context';

// GET/PATCH /organization and GET /organization/members (Phase 8).

export const organizationView = async (ctx: OrgContext) => {
	const org = (await Organization.findById(ctx.organization._id).lean<IOrganization>()) as IOrganization;
	const memberships = await listMemberships(ctx.userId);
	return {
		organization: { id: String(org._id), name: org.name, type: org.type, country: org.country, created_at: org.created_at },
		role: ctx.membership.role,
		memberships: memberships.map((m) => ({
			organization_id: String(m.organization._id),
			name: m.organization.name,
			type: m.organization.type,
			role: m.membership.role,
		})),
	};
};

export const updateOrganization = async (ctx: OrgContext, update: { name?: string; country?: IOrganization['country'] }) => {
	const set: Record<string, unknown> = {};
	if (update.name !== undefined) set.name = update.name;
	if (update.country !== undefined) set.country = update.country;
	await Organization.updateOne({ _id: ctx.organization._id }, { $set: set });
	return organizationView(ctx);
};

export const listMembers = async (ctx: OrgContext) => {
	const members = await Membership.find({ organization_id: ctx.organization._id, status: 'active' }).sort({ created_at: 1, _id: 1 }).lean<IMembership[]>();
	const ids = members.map((m) => m.user_id);
	const [users, profiles] = await Promise.all([
		User.find({ _id: { $in: ids } }).select({ email: 1 }).lean<IUser[]>(),
		Profile.find({ user_id: { $in: ids } }).select({ user_id: 1, name: 1 }).lean<IProfile[]>(),
	]);
	const email = new Map(users.map((u) => [String(u._id), u.email]));
	const name = new Map(profiles.map((p) => [String(p.user_id), p.name ?? null]));
	return members.map((m) => ({
		user_id: String(m.user_id),
		name: name.get(String(m.user_id)) ?? null,
		email: email.get(String(m.user_id)) ?? null,
		role: m.role,
		client_ids: (m.client_ids ?? []).map(String),
		status: m.status,
		invited_by: m.created_by && String(m.created_by) !== String(m.user_id) ? String(m.created_by) : null,
		joined_at: m.created_at,
	}));
};
