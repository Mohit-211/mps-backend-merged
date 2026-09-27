import { Types } from 'mongoose';
import httpStatus from 'http-status';
import { Client, ILocation, IMembership, Location, Membership, MembershipRole } from '../../models';
import { apiErrorWithData } from '../../utils';
import { OrgContext } from './context';
import { setUsageContext } from '../usage/scope';

// Access rules (Phase 8). Locations and clients belong to an organization; a user reaches them through
// an active membership. owner / member: everything in the organization. client_user (agency): read-only,
// only the locations of its assigned clients. Records under a location (rank runs, syncs, reports) are
// reached through the location.

type Id = Types.ObjectId | string;

export const WRITE_ROLES: MembershipRole[] = ['owner', 'member'];

export const readOnly = () => apiErrorWithData(httpStatus.FORBIDDEN, 'This account has read-only access.', { reason: 'read_only' });
export const agencyOnly = () => apiErrorWithData(httpStatus.FORBIDDEN, 'Clients are available to agency organizations only.', { reason: 'agency_only' });
export const ownerOnly = () => apiErrorWithData(httpStatus.FORBIDDEN, 'Only the organization owner can do this.', { reason: 'owner_only' });

export const canWrite = (ctx: Pick<OrgContext, 'membership'>): boolean => WRITE_ROLES.includes(ctx.membership.role);

/** The filter for the locations a context may see. */
export const locationScope = (ctx: Pick<OrgContext, 'organization' | 'membership'>): Record<string, unknown> => ({
	organization_id: ctx.organization._id,
	is_active: true,
	...(ctx.membership.role === 'client_user' ? { client_id: { $in: ctx.membership.client_ids } } : {}),
});

/** The filter for the clients a context may see. */
export const clientScope = (ctx: Pick<OrgContext, 'organization' | 'membership'>): Record<string, unknown> => ({
	organization_id: ctx.organization._id,
	is_active: true,
	...(ctx.membership.role === 'client_user' ? { _id: { $in: ctx.membership.client_ids } } : {}),
});

export const findAccessibleLocation = (ctx: Pick<OrgContext, 'organization' | 'membership'>, locationId: Id) =>
	Location.findOne({ _id: locationId, ...locationScope(ctx) });

/** $and keeps the requested id and a client_user's allowed ids apart (both filter on _id). */
export const findAccessibleClient = (ctx: Pick<OrgContext, 'organization' | 'membership'>, clientId: Id) =>
	Client.findOne({ $and: [{ _id: clientId }, clientScope(ctx)] });

export interface LocationAccess {
	location: ILocation;
	membership: IMembership;
}

/**
 * A location reached by id, whatever organization it is in, if the user is an active member there.
 * `write` requires owner/member. null when the location doesn't exist or the user can't reach it
 * (callers answer 404, so other organizations' ids aren't revealed); throws read_only for a client_user write.
 */
export const findLocationForUser = async (userId: Id, locationId: Id, opts: { write: boolean }): Promise<LocationAccess | null> => {
	const location = await Location.findOne({ _id: locationId, is_active: true });
	if (!location || !location.organization_id) return null;
	const membership = await Membership.findOne({ user_id: userId, organization_id: location.organization_id, status: 'active' }).lean<IMembership>();
	if (!membership) return null;
	if (membership.role === 'client_user') {
		const allowed = (membership.client_ids ?? []).some((id) => location.client_id && String(id) === String(location.client_id));
		if (!allowed) return null;
		if (opts.write) throw readOnly();
	}
	setUsageContext({ organization_id: location.organization_id, location_id: location._id as Types.ObjectId });
	return { location, membership };
};
