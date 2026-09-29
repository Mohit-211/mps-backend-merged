import httpStatus from 'http-status';
import { Types } from 'mongoose';
import { ENTITLEMENT_STATES, EntitlementState } from '../../billing/constants';
import { Client, IInvoice, IMembership, Invoice, IOrganization, Location, LocationCitation, Membership, Organization, Profile, User } from '../../models';
import { apiErrorWithData } from '../../utils';
import { billingOverview } from '../billing/account.service';
import { audit, AuditActor } from '../billing/audit';
import { loadEntitlement } from '../billing/entitlement.service';
import { invoiceView } from '../billing/invoices';

// Admin panel: organizations (Phase 13b), behind platform.read / platform.write: list with billing state,
// detail (owner, members, locations, clients, usage, billing, invoices, tokens, citations), suspend /
// unsuspend, trial extension and limit overrides. Every change is audit-logged.

const oid = (id: string) => (Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null);
const DAY = 86_400_000;
const esc = (s: string) => s.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const loadOrg = async (organizationId: string): Promise<IOrganization> => {
	const id = oid(organizationId);
	const org = id ? await Organization.findById(id).lean<IOrganization>() : null;
	if (!org) throw apiErrorWithData(httpStatus.NOT_FOUND, 'Organization not found.', { reason: 'not_found' });
	return org;
};

export interface OrgListFilter {
	q?: string;
	type?: 'business' | 'agency';
	state?: EntitlementState;
	plan?: 'standard' | 'custom';
	trial_ending_days?: number;
	page: number;
	limit: number;
}

export const listOrganizations = async (f: OrgListFilter, now: Date = new Date()) => {
	const q: Record<string, unknown> = {};
	if (f.q) {
		const owners = await User.find({ email: { $regex: esc(f.q), $options: 'i' } }).select({ _id: 1 }).limit(200).lean<{ _id: Types.ObjectId }[]>();
		q.$or = [{ name: { $regex: esc(f.q), $options: 'i' } }, { owner_user_id: { $in: owners.map((o) => o._id) } }];
	}
	if (f.type) q.type = f.type;
	if (f.plan === 'custom') q.plan_id = { $ne: null };
	if (f.plan === 'standard') q.plan_id = null;
	if (f.trial_ending_days) q.trial_ends_at = { $gt: now, $lte: new Date(now.getTime() + f.trial_ending_days * DAY) };
	// The billing state is computed per organization, so a state filter pages over the computed rows.
	const all = await Organization.find(q).sort({ created_at: -1 }).lean<IOrganization[]>();
	const rows = [];
	for (const org of all) {
		const e = (await loadEntitlement(org, now)).entitlement;
		if (f.state && e.state !== f.state) continue;
		if (f.trial_ending_days && e.state !== 'trialing') continue;
		rows.push({ org, e });
	}
	const page = rows.slice((f.page - 1) * f.limit, f.page * f.limit);
	const owners = await User.find({ _id: { $in: page.map((r) => r.org.owner_user_id) } }).select({ email: 1 }).lean<{ _id: Types.ObjectId; email: string }[]>();
	const ownerEmail = new Map(owners.map((o) => [String(o._id), o.email]));
	return {
		organizations: page.map(({ org, e }) => ({
			id: String(org._id),
			name: org.name,
			type: org.type,
			country: org.country,
			owner_email: ownerEmail.get(String(org.owner_user_id)) ?? null,
			plan: org.plan_id ? 'custom' : 'standard',
			state: e.state,
			trial_ends_at: org.trial_ends_at ?? null,
			locations: e.locations,
			users: e.users,
			token_balance: org.token_balance ?? 0,
			suspended_at: org.suspended_at ?? null,
			created_at: org.created_at,
		})),
		page: f.page,
		limit: f.limit,
		total: rows.length,
	};
};

export const getOrganization = async (organizationId: string) => {
	const org = await loadOrg(organizationId);
	const [owner, memberships, locations, clients, invoices, citationCounts, billing] = await Promise.all([
		User.findById(org.owner_user_id).select({ email: 1 }).lean<{ email: string }>(),
		Membership.find({ organization_id: org._id }).lean<IMembership[]>(),
		Location.find({ organization_id: org._id, is_active: true }).select({ name: 1, city: 1, gbp_connected: 1, source: 1, created_at: 1 }).sort({ created_at: 1 }).lean<{ _id: Types.ObjectId; name: string; city?: string; gbp_connected?: boolean; source?: string; created_at: Date }[]>(),
		Client.countDocuments({ organization_id: org._id }),
		Invoice.find({ organization_id: org._id }).sort({ issued_at: -1 }).limit(10).lean<IInvoice[]>(),
		LocationCitation.aggregate<{ _id: string; n: number }>([{ $match: { organization_id: org._id, active: { $ne: false } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
		billingOverview(org._id as Types.ObjectId),
	]);
	const users = await User.find({ _id: { $in: memberships.map((m) => m.user_id) } }).select({ email: 1 }).lean<{ _id: Types.ObjectId; email: string }[]>();
	const profiles = await Profile.find({ user_id: { $in: memberships.map((m) => m.user_id) } }).select({ user_id: 1, name: 1 }).lean<{ user_id: Types.ObjectId; name?: string }[]>();
	const emailOf = new Map(users.map((u) => [String(u._id), u.email]));
	const nameOf = new Map(profiles.map((p) => [String(p.user_id), p.name ?? null]));
	return {
		organization: {
			id: String(org._id),
			name: org.name,
			type: org.type,
			country: org.country,
			created_at: org.created_at,
			owner: { id: String(org.owner_user_id), email: owner?.email ?? null },
			suspended_at: org.suspended_at ?? null,
			suspended_reason: org.suspended_reason ?? null,
			limit_overrides: org.limit_overrides ?? null,
		},
		members: memberships.map((m) => ({ user_id: String(m.user_id), email: emailOf.get(String(m.user_id)) ?? null, name: nameOf.get(String(m.user_id)) ?? null, role: m.role, status: m.status })),
		locations: locations.map((l) => ({ id: String(l._id), name: l.name, city: l.city ?? null, gbp_connected: Boolean(l.gbp_connected), source: l.source ?? null })),
		clients,
		billing,
		invoices: invoices.map(invoiceView),
		citations: Object.fromEntries(citationCounts.map((c) => [c._id, c.n])),
	};
};

/** Suspended organizations are read-only (money-costing actions answer 403 organization_suspended). */
export const suspendOrganization = async (actor: AuditActor, organizationId: string, reason: string, now: Date = new Date()) => {
	const org = await loadOrg(organizationId);
	if (org.suspended_at) throw apiErrorWithData(httpStatus.CONFLICT, 'The organization is already suspended.', { reason: 'already_suspended' });
	await Organization.updateOne({ _id: org._id }, { $set: { suspended_at: now, suspended_reason: reason } });
	await audit(actor, { action: 'admin.organization.suspend', organization_id: org._id, before: null, after: { suspended_at: now }, note: reason }, now);
	return getOrganization(organizationId);
};

export const unsuspendOrganization = async (actor: AuditActor, organizationId: string, note: string | null) => {
	const org = await loadOrg(organizationId);
	if (!org.suspended_at) throw apiErrorWithData(httpStatus.CONFLICT, 'The organization is not suspended.', { reason: 'not_suspended' });
	await Organization.updateOne({ _id: org._id }, { $set: { suspended_at: null, suspended_reason: null } });
	await audit(actor, { action: 'admin.organization.unsuspend', organization_id: org._id, before: { suspended_at: org.suspended_at, reason: org.suspended_reason }, after: null, note });
	return getOrganization(organizationId);
};

export const extendTrial = async (actor: AuditActor, organizationId: string, until: Date) => {
	const org = await loadOrg(organizationId);
	await Organization.updateOne({ _id: org._id }, { $set: { trial_ends_at: until, billing_reminders: null } });
	await audit(actor, { action: 'admin.organization.trial', organization_id: org._id, before: org.trial_ends_at ?? null, after: until });
	return { trial_ends_at: until };
};

/**
 * Per-organization limit overrides on top of the plan: `max_locations` (the cap; null = no cap) and
 * `extra_users` (added to the pooled user limit). An empty body clears them.
 */
export const setLimitOverrides = async (actor: AuditActor, organizationId: string, input: { max_locations?: number | null; extra_users?: number }) => {
	const org = await loadOrg(organizationId);
	const next: Record<string, unknown> = {};
	if (input.max_locations !== undefined) next.max_locations = input.max_locations;
	if (input.extra_users !== undefined) next.extra_users = input.extra_users;
	const value = Object.keys(next).length ? next : null;
	await Organization.updateOne({ _id: org._id }, { $set: { limit_overrides: value } });
	await audit(actor, { action: 'admin.organization.limits', organization_id: org._id, before: org.limit_overrides ?? null, after: value });
	return getOrganization(organizationId);
};

export { ENTITLEMENT_STATES };
