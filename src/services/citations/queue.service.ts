import { PipelineStage, Types } from 'mongoose';
import config from '../../configs/config';
import { CitationStatus, DirectoryType } from '../../citations/constants';
import { CitationStatusLog, Client, Directory, ICitationStatusLog, IDirectory, ILocationCitation, Location, LocationCitation, Organization } from '../../models';
import { oid, paging } from './common';
import { adminLogView, entryView } from './entries.service';

// The admin work queue (Phase 16): locations with unchecked citations, entries not checked for N days,
// and recently changed entries. Filters: organization, client, status, directory, directory type.
// Soft-deleted locations and entries taken off a list are excluded.

export interface QueueFilters {
	organization_id?: string;
	client_id?: string;
	status?: CitationStatus;
	directory_id?: string;
	type?: DirectoryType;
	page?: number;
	limit?: number;
	days?: number;
}

const DAY_MS = 86_400_000;

/** Joins the entry's location and drops soft-deleted ones. */
const liveLocationStages = (localField: string): PipelineStage[] => [
	{ $lookup: { from: 'locations', localField, foreignField: '_id', as: 'loc', pipeline: [{ $project: { name: 1, city: 1, organization_id: 1, client_id: 1, deleted_at: 1 } }] } },
	{ $unwind: '$loc' },
	{ $match: { 'loc.deleted_at': null } },
];

/** The shared entry / log filters. `directoryField` is directory_id on both collections. */
const baseMatch = async (f: QueueFilters): Promise<Record<string, unknown>> => {
	const match: Record<string, unknown> = {};
	if (f.organization_id) match.organization_id = oid(f.organization_id);
	if (f.client_id) {
		const locs = await Location.find({ client_id: oid(f.client_id) }).select({ _id: 1 }).lean<{ _id: Types.ObjectId }[]>();
		match.location_id = { $in: locs.map((l) => l._id) };
	}
	const dirIds: Types.ObjectId[][] = [];
	if (f.directory_id) dirIds.push([oid(f.directory_id)]);
	if (f.type) dirIds.push((await Directory.find({ type: f.type }).select({ _id: 1 }).lean<{ _id: Types.ObjectId }[]>()).map((d) => d._id));
	if (dirIds.length) {
		const [first, ...rest] = dirIds;
		match.directory_id = { $in: first.filter((id) => rest.every((ids) => ids.some((x) => x.equals(id)))) };
	}
	return match;
};

interface LocMini {
	_id: Types.ObjectId;
	name: string;
	city?: string;
	organization_id?: Types.ObjectId;
	client_id?: Types.ObjectId | null;
}

/** Organization and client names for the locations on a page. */
const labels = async (locs: LocMini[]) => {
	const orgIds = [...new Set(locs.map((l) => String(l.organization_id ?? '')).filter(Boolean))];
	const clientIds = [...new Set(locs.map((l) => String(l.client_id ?? '')).filter(Boolean))];
	const orgs: { _id: Types.ObjectId; name: string }[] = orgIds.length ? await Organization.find({ _id: { $in: orgIds.map(oid) } }).select({ name: 1 }).lean<{ _id: Types.ObjectId; name: string }[]>() : [];
	const clients: { _id: Types.ObjectId; company_name: string }[] = clientIds.length
		? await Client.find({ _id: { $in: clientIds.map(oid) } }).select({ company_name: 1 }).lean<{ _id: Types.ObjectId; company_name: string }[]>()
		: [];
	const orgName = new Map(orgs.map((o) => [String(o._id), o.name]));
	const clientName = new Map(clients.map((c) => [String(c._id), c.company_name]));
	return (l: LocMini) => ({
		id: String(l._id),
		name: l.name,
		city: l.city && l.city.toLowerCase() !== 'n/a' ? l.city : null,
		organization: l.organization_id ? { id: String(l.organization_id), name: orgName.get(String(l.organization_id)) ?? null } : null,
		client: l.client_id ? { id: String(l.client_id), name: clientName.get(String(l.client_id)) ?? null } : null,
	});
};

const facet = (skip: number, limit: number): PipelineStage[] => [{ $facet: { rows: [{ $skip: skip }, { $limit: limit }], total: [{ $count: 'n' }] } }];

export const createQueueService = (deps: { now?: () => Date } = {}) => {
	const now = deps.now ?? (() => new Date());

	/** Locations with `not_checked` entries, the ones waiting longest first. */
	const unchecked = async (f: QueueFilters) => {
		const { page, limit } = paging(f);
		const match = { ...(await baseMatch(f)), active: true, status: 'not_checked' };
		const [out] = await LocationCitation.aggregate<{ rows: { _id: Types.ObjectId; unchecked: number; oldest_added_at: Date; loc: LocMini }[]; total: { n: number }[] }>([
			{ $match: match },
			{ $group: { _id: '$location_id', unchecked: { $sum: 1 }, oldest_added_at: { $min: '$created_at' } } },
			...liveLocationStages('_id'),
			{ $sort: { oldest_added_at: 1, _id: 1 } },
			...facet((page - 1) * limit, limit),
		]);
		const rows = out?.rows ?? [];
		const totals = await LocationCitation.aggregate<{ _id: Types.ObjectId; n: number }>([
			{ $match: { location_id: { $in: rows.map((r) => r._id) }, active: true } },
			{ $group: { _id: '$location_id', n: { $sum: 1 } } },
		]);
		const totalOf = new Map(totals.map((t) => [String(t._id), t.n]));
		const label = await labels(rows.map((r) => ({ ...r.loc, _id: r._id })));
		return {
			locations: rows.map((r) => ({ location: label({ ...r.loc, _id: r._id }), unchecked: r.unchecked, active_entries: totalOf.get(String(r._id)) ?? r.unchecked, oldest_added_at: r.oldest_added_at })),
			page,
			limit,
			total: out?.total[0]?.n ?? 0,
		};
	};

	/** Checked entries not checked again for N days (default CITATION_STALE_DAYS), oldest check first. */
	const stale = async (f: QueueFilters) => {
		const { page, limit } = paging(f);
		const days = f.days ?? config.citations.staleDays;
		const cutoff = new Date(now().getTime() - days * DAY_MS);
		const status = f.status && f.status !== 'not_checked' ? f.status : { $ne: 'not_checked' };
		const match = { ...(await baseMatch(f)), active: true, status, $or: [{ last_checked_at: { $lt: cutoff } }, { last_checked_at: null }] };
		const [out] = await LocationCitation.aggregate<{ rows: (ILocationCitation & { loc: LocMini })[]; total: { n: number }[] }>([
			{ $match: match },
			{ $sort: { last_checked_at: 1, _id: 1 } },
			...liveLocationStages('location_id'),
			...facet((page - 1) * limit, limit),
		]);
		const rows = out?.rows ?? [];
		const dirs = rows.length ? await Directory.find({ _id: { $in: rows.map((r) => r.directory_id) } }).lean<IDirectory[]>() : [];
		const dirOf = new Map(dirs.map((d) => [String(d._id), d]));
		const label = await labels(rows.map((r) => r.loc));
		return {
			days,
			entries: rows.map((r) => ({
				...entryView(r, dirOf.get(String(r.directory_id))),
				location: label(r.loc),
				days_since_check: r.last_checked_at ? Math.floor((now().getTime() - new Date(r.last_checked_at).getTime()) / DAY_MS) : null,
			})),
			page,
			limit,
			total: out?.total[0]?.n ?? 0,
		};
	};

	/** History rows of the last N days (default 7), newest first. `status` filters on the new status. */
	const recent = async (f: QueueFilters) => {
		const { page, limit } = paging(f);
		const days = f.days ?? 7;
		const since = new Date(now().getTime() - days * DAY_MS);
		const match: Record<string, unknown> = { ...(await baseMatch(f)), at: { $gte: since } };
		if (f.status) match.to = f.status;
		const [out] = await CitationStatusLog.aggregate<{ rows: (ICitationStatusLog & { loc: LocMini })[]; total: { n: number }[] }>([
			{ $match: match },
			{ $sort: { at: -1, _id: -1 } },
			...liveLocationStages('location_id'),
			...facet((page - 1) * limit, limit),
		]);
		const rows = out?.rows ?? [];
		const dirs = rows.length ? await Directory.find({ _id: { $in: rows.map((r) => r.directory_id) } }).select({ name: 1, type: 1 }).lean<{ _id: Types.ObjectId; name: string; type: string }[]>() : [];
		const dirOf = new Map(dirs.map((d) => [String(d._id), d]));
		const label = await labels(rows.map((r) => r.loc));
		return {
			days,
			changes: rows.map((r) => ({ ...adminLogView(r), directory: { id: String(r.directory_id), name: dirOf.get(String(r.directory_id))?.name ?? '(deleted directory)', type: dirOf.get(String(r.directory_id))?.type ?? null }, location: label(r.loc) })),
			page,
			limit,
			total: out?.total[0]?.n ?? 0,
		};
	};

	return { unchecked, stale, recent };
};

export const queueService = createQueueService();
