import { Types } from 'mongoose';
import httpStatus from 'http-status';
import { IMembership, IOrganization, Membership, Organization, User } from '../../models';
import { apiErrorWithData } from '../../utils';
import { standardPlan } from '../billing/plans';
import { credit } from '../billing/tokens';

// Organization context (Phase 8): which organization a request acts in, and the caller's role there.
// The X-Organization-Id header picks one of the user's organizations; otherwise the user's default
// organization, otherwise the oldest membership.

type UserId = Types.ObjectId | string;

export interface OrgContext {
	userId: string;
	organization: Pick<IOrganization, '_id' | 'name' | 'type' | 'country' | 'owner_user_id' | 'onboarding' | 'created_at'>;
	membership: Pick<IMembership, '_id' | 'role' | 'client_ids'>;
}

export const noOrganization = () => apiErrorWithData(httpStatus.FORBIDDEN, 'No organization for this account.', { reason: 'no_organization' });

/** Every active membership of a user, with its organization (oldest first). */
export const listMemberships = async (userId: UserId) => {
	const memberships = await Membership.find({ user_id: userId, status: 'active' }).sort({ created_at: 1, _id: 1 }).lean<IMembership[]>();
	const orgs = await Organization.find({ _id: { $in: memberships.map((m) => m.organization_id) }, is_active: true }).lean<IOrganization[]>();
	const byId = new Map(orgs.map((o) => [String(o._id), o]));
	return memberships.filter((m) => byId.has(String(m.organization_id))).map((m) => ({ membership: m, organization: byId.get(String(m.organization_id)) as IOrganization }));
};

/**
 * Resolves the organization for a request. Throws 403 no_organization when the user has none, and
 * 403 not_a_member when the requested organization isn't one of the user's.
 */
export const resolveOrgContext = async (userId: UserId, requestedOrgId?: string | null): Promise<OrgContext> => {
	const all = await listMemberships(userId);
	if (all.length === 0) throw noOrganization();
	let chosen = all[0];
	if (requestedOrgId) {
		const match = all.find((m) => String(m.organization._id) === requestedOrgId);
		if (!match) throw apiErrorWithData(httpStatus.FORBIDDEN, 'You are not a member of this organization.', { reason: 'not_a_member' });
		chosen = match;
	} else {
		const user = await User.findById(userId).select({ default_organization_id: 1 }).lean<{ default_organization_id?: Types.ObjectId | null }>();
		const preferred = all.find((m) => user?.default_organization_id && String(m.organization._id) === String(user.default_organization_id));
		if (preferred) chosen = preferred;
	}
	const { organization: o, membership: m } = chosen;
	return {
		userId: String(userId),
		organization: { _id: o._id, name: o.name, type: o.type, country: o.country, owner_user_id: o.owner_user_id, onboarding: o.onboarding, created_at: o.created_at },
		membership: { _id: m._id, role: m.role, client_ids: m.client_ids ?? [] },
	};
};

/** Creates an organization with the user as owner and makes it the user's default. */
export const createOrganizationForOwner = async (
	userId: UserId,
	input: { name: string; type: IOrganization['type']; country: IOrganization['country'] },
): Promise<IOrganization> => {
	// Phase 13a: every new organization starts its trial (the standard plan's length and token allowance).
	const plan = await standardPlan();
	const now = new Date();
	const organization = await Organization.create({ name: input.name, type: input.type, country: input.country, owner_user_id: userId, trial_ends_at: new Date(now.getTime() + plan.trial.days * 86_400_000) });
	await Membership.create({ organization_id: organization._id, user_id: userId, role: 'owner', created_by: userId });
	if (plan.trial.tokens > 0) await credit(organization._id as Types.ObjectId, 'grant', plan.trial.tokens, { note: 'Trial tokens' }, now);
	await User.updateOne({ _id: userId }, { $set: { default_organization_id: organization._id } });
	return organization;
};

/** "United States", "USA", "Canada", "CA"… → 'US' | 'CA' | null. */
export const normaliseOrgCountry = (country: string | null | undefined): IOrganization['country'] => {
	const c = (country ?? '').trim().toLowerCase().replace(/\./g, '');
	if (['us', 'usa', 'united states', 'united states of america'].includes(c)) return 'US';
	if (['ca', 'can', 'canada'].includes(c)) return 'CA';
	return null;
};

