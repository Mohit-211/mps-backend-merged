import httpStatus from 'http-status';
import { Types } from 'mongoose';
import { CitationCountry, DirectoryType } from '../../citations/constants';
import { isRegionOf } from '../../citations/regions';
import { Directory, DirectoryCategory, IDirectory, LocationCitation } from '../../models';
import { apiErrorWithData } from '../../utils';
import { AdminActor, domainOf, escapeRegex, oid, paging } from './common';

// The directory master list (Phase 16): CRUD for platform admins. Deleting deactivates: entries that
// already use a directory keep it (shown as inactive in lists), and it is no longer suggested.

export interface DirectoryInput {
	name?: string;
	url?: string;
	type?: DirectoryType;
	category_ids?: string[];
	countries?: CitationCountry[];
	regions?: string[];
	authority?: number | null;
	notes?: string | null;
	is_active?: boolean;
}

export interface DirectoryQuery {
	q?: string;
	type?: DirectoryType;
	country?: CitationCountry;
	category_id?: string;
	active?: boolean;
	page?: number;
	limit?: number;
}

export interface DirectoryView {
	id: string;
	name: string;
	url: string;
	domain: string;
	type: DirectoryType;
	categories: { id: string; name: string; slug: string }[];
	countries: CitationCountry[];
	regions: string[];
	authority: number | null;
	notes: string | null;
	is_active: boolean;
	created_at: Date;
	updated_at: Date;
}

const DUPLICATE_KEY = 11000;

export const directoryViews = async (rows: IDirectory[]): Promise<DirectoryView[]> => {
	const ids = [...new Set(rows.flatMap((r) => r.category_ids.map(String)))];
	const cats = ids.length ? await DirectoryCategory.find({ _id: { $in: ids.map(oid) } }).select({ name: 1, slug: 1 }).lean<{ _id: Types.ObjectId; name: string; slug: string }[]>() : [];
	const byId = new Map(cats.map((c) => [String(c._id), c]));
	return rows.map((r) => ({
		id: String(r._id),
		name: r.name,
		url: r.url,
		domain: r.domain,
		type: r.type,
		categories: r.category_ids.flatMap((id) => {
			const c = byId.get(String(id));
			return c ? [{ id: String(id), name: c.name, slug: c.slug }] : [];
		}),
		countries: r.countries,
		regions: r.regions,
		authority: r.authority ?? null,
		notes: r.notes ?? null,
		is_active: r.is_active,
		created_at: r.created_at,
		updated_at: r.updated_at,
	}));
};

/** Checks a full directory (after merging an update): the rules shared by the API and the CSV import. */
export const directoryProblems = (d: {
	name: string;
	url: string;
	type: DirectoryType;
	category_ids: string[];
	countries: CitationCountry[];
	regions: string[];
	authority: number | null;
}): { field: string; message: string }[] => {
	const out: { field: string; message: string }[] = [];
	if (!d.name.trim() || d.name.trim().length > 120) out.push({ field: 'name', message: 'name must be 1–120 characters' });
	if (!domainOf(d.url) || d.url.length > 300) out.push({ field: 'url', message: 'url must be an http(s) URL of at most 300 characters' });
	if (!d.countries.length) out.push({ field: 'countries', message: 'at least one country (US, CA) is required' });
	if (d.type === 'niche' && !d.category_ids.length) out.push({ field: 'categories', message: 'a niche directory needs at least one category' });
	const badRegion = d.regions.find((r) => !d.countries.some((c) => isRegionOf(c, r)));
	if (badRegion) out.push({ field: 'regions', message: `"${badRegion}" is not a state or province of the listed countries` });
	if (d.authority !== null && (!Number.isInteger(d.authority) || d.authority < 0 || d.authority > 100)) out.push({ field: 'authority', message: 'authority must be an integer 0–100' });
	return out;
};

const invalid = (problems: { field: string; message: string }[]) =>
	apiErrorWithData(httpStatus.BAD_REQUEST, problems.map((p) => p.message).join('; '), { reason: 'invalid_directory', problems });

export const createDirectoryService = () => {
	const getOr404 = async (id: string): Promise<IDirectory> => {
		const row = await Directory.findById(id).lean<IDirectory>();
		if (!row) throw apiErrorWithData(httpStatus.NOT_FOUND, 'Directory not found.', { reason: 'not_found' });
		return row;
	};

	const checkCategories = async (ids: string[]): Promise<void> => {
		const unique = [...new Set(ids)];
		if (unique.length && (await DirectoryCategory.countDocuments({ _id: { $in: unique.map(oid) } })) !== unique.length) {
			throw invalid([{ field: 'categories', message: 'unknown directory category' }]);
		}
	};

	const list = async (query: DirectoryQuery) => {
		const { page, limit } = paging(query);
		const filter: Record<string, unknown> = {};
		if (query.q) filter.$or = [{ name: new RegExp(escapeRegex(query.q.trim()), 'i') }, { domain: new RegExp(escapeRegex(query.q.trim().toLowerCase()), 'i') }];
		if (query.type) filter.type = query.type;
		if (query.country) filter.countries = query.country;
		if (query.category_id) filter.category_ids = oid(query.category_id);
		if (query.active !== undefined) filter.is_active = query.active;
		const [rows, total] = await Promise.all([
			Directory.find(filter).sort({ name: 1 }).skip((page - 1) * limit).limit(limit).lean<IDirectory[]>(),
			Directory.countDocuments(filter),
		]);
		return { directories: await directoryViews(rows), page, limit, total };
	};

	const get = async (id: string) => {
		const row = await getOr404(id);
		const [view] = await directoryViews([row]);
		const used_by_locations = await LocationCitation.countDocuments({ directory_id: row._id, active: true });
		return { ...view, used_by_locations };
	};

	const save = async (id: string | null, input: DirectoryInput, actor: AdminActor): Promise<DirectoryView> => {
		const current = id ? await getOr404(id) : null;
		const merged = {
			name: input.name ?? current?.name ?? '',
			url: input.url ?? current?.url ?? '',
			type: input.type ?? current?.type ?? 'general',
			category_ids: input.category_ids ?? (current?.category_ids ?? []).map(String),
			countries: input.countries ?? current?.countries ?? [],
			regions: (input.regions ?? current?.regions ?? []).map((r) => r.trim().toUpperCase()),
			authority: input.authority !== undefined ? input.authority : current?.authority ?? null,
		};
		if (!id && !input.type) throw invalid([{ field: 'type', message: 'type is required' }]);
		const problems = directoryProblems(merged);
		if (problems.length) throw invalid(problems);
		await checkCategories(merged.category_ids);
		const set = {
			...merged,
			name: merged.name.trim(),
			url: merged.url.trim(),
			domain: domainOf(merged.url) as string,
			category_ids: [...new Set(merged.category_ids)].map(oid),
			countries: [...new Set(merged.countries)],
			regions: [...new Set(merged.regions)],
			notes: input.notes !== undefined ? input.notes : current?.notes ?? null,
			is_active: input.is_active ?? current?.is_active ?? true,
			updated_by: oid(actor.id),
		};
		try {
			if (!id) {
				const created = await Directory.create({ ...set, created_by: oid(actor.id) });
				return (await directoryViews([created.toObject() as IDirectory]))[0];
			}
			await Directory.updateOne({ _id: oid(id) }, { $set: set });
			return (await directoryViews([await getOr404(id)]))[0];
		} catch (err) {
			if ((err as { code?: number }).code === DUPLICATE_KEY) {
				throw apiErrorWithData(httpStatus.CONFLICT, 'A directory with this domain already exists.', { reason: 'domain_taken', domain: set.domain });
			}
			throw err;
		}
	};

	const deactivate = async (id: string, actor: AdminActor): Promise<DirectoryView> => {
		await getOr404(id);
		await Directory.updateOne({ _id: oid(id) }, { $set: { is_active: false, updated_by: oid(actor.id) } });
		return (await directoryViews([await getOr404(id)]))[0];
	};

	return {
		list,
		get,
		create: (input: DirectoryInput, actor: AdminActor) => save(null, input, actor),
		update: (id: string, input: DirectoryInput, actor: AdminActor) => save(id, input, actor),
		deactivate,
	};
};

export const directoryService = createDirectoryService();
