import { Types } from 'mongoose';
import httpStatus from 'http-status';
import { userStatusTypes } from '../../configs/constantTypes';
import { Client, IClient, ILocation, Location } from '../../models';
import { ApiError } from '../../utils';
import { OrgContext } from '../org/context';
import { clientScope, findAccessibleClient, locationScope } from '../org/access';
import { LocationRow, rowsFor } from '../locations/locations.service';

// Agency clients (Phase 8): CRUD within the organization and location assignment. Reuses the legacy
// Client model (extended with organization_id); replaces the per-user /user/clients service.

export const CLIENT_STATUSES = [userStatusTypes.ACTIVE, userStatusTypes.INACTIVE] as const;

export interface ClientView {
	client_id: string;
	name: string;
	website: string | null;
	contact_email: string | null;
	status: string;
	locations_count: number;
	avg_rank: number | null;
	avg_gbp_score: number | null;
	created_at: Date;
}

const mean = (values: (number | null | undefined)[]): number | null => {
	const nums = values.filter((v): v is number => typeof v === 'number');
	return nums.length ? Math.round((nums.reduce((s, v) => s + v, 0) / nums.length) * 10) / 10 : null;
};

const toView = (c: IClient, locations: Pick<ILocation, 'client_id' | 'summary'>[]): ClientView => {
	const own = locations.filter((l) => l.client_id && String(l.client_id) === String(c._id));
	return {
		client_id: String(c._id),
		name: c.company_name,
		website: c.company_URL ?? null,
		contact_email: c.contact_email ?? null,
		status: c.status,
		locations_count: own.length,
		avg_rank: mean(own.map((l) => l.summary?.overall_avg_rank)),
		avg_gbp_score: mean(own.map((l) => l.summary?.gbp_score)),
		created_at: c.created_at,
	};
};

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface ClientListQuery {
	search?: string;
	status?: string;
	page?: number;
	limit?: number;
}

export const listClients = async (ctx: OrgContext, query: ClientListQuery) => {
	const page = Math.max(1, query.page ?? 1);
	const limit = Math.min(100, Math.max(1, query.limit ?? 25));
	const filter: Record<string, unknown> = { ...clientScope(ctx) };
	if (query.status) filter.status = query.status;
	if (query.search) filter.company_name = new RegExp(escapeRegex(query.search.trim()), 'i');
	const [clients, total] = await Promise.all([
		Client.find(filter).sort({ company_name: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean<IClient[]>(),
		Client.countDocuments(filter),
	]);
	const locations = await Location.find({ ...locationScope(ctx), client_id: { $in: clients.map((c) => c._id) } })
		.select({ client_id: 1, summary: 1 })
		.lean<ILocation[]>();
	return { clients: clients.map((c) => toView(c, locations)), page, limit, total };
};

export interface ClientInput {
	name?: string;
	website?: string | null;
	contact_email?: string | null;
	status?: string;
}

export const createClient = async (ctx: OrgContext, input: ClientInput): Promise<ClientView> => {
	const client = await Client.create({
		company_name: input.name,
		company_URL: input.website ?? null,
		contact_email: input.contact_email ?? null,
		organization_id: ctx.organization._id,
		created_by: ctx.userId,
	});
	return toView(client.toObject() as IClient, []);
};

const accessible = async (ctx: OrgContext, clientId: string) => {
	if (!Types.ObjectId.isValid(clientId)) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid clientId');
	const client = await findAccessibleClient(ctx, clientId).lean<IClient>();
	if (!client) throw new ApiError(httpStatus.NOT_FOUND, 'Client not found');
	return client;
};

export const getClientDetail = async (ctx: OrgContext, clientId: string): Promise<{ client: ClientView; locations: LocationRow[]; summary: Record<string, number | null> }> => {
	const client = await accessible(ctx, clientId);
	const locations = await Location.find({ ...locationScope(ctx), client_id: client._id }).sort({ name: 1 }).lean<ILocation[]>();
	const rows = await rowsFor(locations);
	return {
		client: toView(client, locations),
		locations: rows,
		summary: {
			locations: rows.length,
			avg_rank: mean(locations.map((l) => l.summary?.overall_avg_rank)),
			avg_gbp_score: mean(locations.map((l) => l.summary?.gbp_score)),
			gbp_connected: rows.filter((r) => r.gbp_connected).length,
		},
	};
};

export const updateClient = async (ctx: OrgContext, clientId: string, input: ClientInput): Promise<ClientView> => {
	const client = await accessible(ctx, clientId);
	const set: Record<string, unknown> = { updated_by: ctx.userId };
	if (input.name !== undefined) set.company_name = input.name;
	if (input.website !== undefined) set.company_URL = input.website;
	if (input.contact_email !== undefined) set.contact_email = input.contact_email;
	if (input.status !== undefined) set.status = input.status;
	await Client.updateOne({ _id: client._id }, { $set: set });
	return (await listOne(ctx, String(client._id))) as ClientView;
};

const listOne = async (ctx: OrgContext, clientId: string): Promise<ClientView | null> => {
	const client = await Client.findOne({ $and: [{ _id: clientId }, clientScope(ctx)] }).lean<IClient>();
	if (!client) return null;
	const locations = await Location.find({ ...locationScope(ctx), client_id: client._id }).select({ client_id: 1, summary: 1 }).lean<ILocation[]>();
	return toView(client, locations);
};

/** Soft delete; its locations stay in the organization, unassigned. */
export const deleteClient = async (ctx: OrgContext, clientId: string) => {
	const client = await accessible(ctx, clientId);
	const unassigned = await Location.updateMany({ organization_id: ctx.organization._id, client_id: client._id }, { $set: { client_id: null } });
	await Client.updateOne({ _id: client._id }, { $set: { is_active: false, deleted_at: new Date(), deleted_by: ctx.userId } });
	return { deleted: true, locations_unassigned: unassigned.modifiedCount };
};

export const assignLocation = async (ctx: OrgContext, clientId: string, locationId: string) => {
	const client = await accessible(ctx, clientId);
	if (!Types.ObjectId.isValid(locationId)) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid location_id');
	const updated = await Location.updateOne({ _id: locationId, organization_id: ctx.organization._id, is_active: true }, { $set: { client_id: client._id } });
	if (updated.matchedCount === 0) throw new ApiError(httpStatus.NOT_FOUND, 'Location not found');
	return { assigned: true, client_id: String(client._id), location_id: locationId };
};

export const unassignLocation = async (ctx: OrgContext, clientId: string, locationId: string) => {
	const client = await accessible(ctx, clientId);
	if (!Types.ObjectId.isValid(locationId)) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid locationId');
	const updated = await Location.updateOne({ _id: locationId, organization_id: ctx.organization._id, client_id: client._id, is_active: true }, { $set: { client_id: null } });
	if (updated.matchedCount === 0) throw new ApiError(httpStatus.NOT_FOUND, 'This location is not assigned to this client');
	return { unassigned: true, client_id: String(client._id), location_id: locationId };
};
