import httpStatus from 'http-status';
import slugify from 'slugify';
import { Types } from 'mongoose';
import { BusinessCategory, Directory, DirectoryCategory, IDirectoryCategory } from '../../models';
import { apiErrorWithData } from '../../utils';
import { AdminActor, escapeRegex, oid } from './common';

// Directory categories (Phase 16): industry groups mapped to GBP business categories. Platform admins
// manage them; directories reference them; locations match them through their business categories.

export interface CategoryInput {
	name?: string;
	slug?: string;
	business_category_ids?: string[];
	is_active?: boolean;
}

export interface CategoryView {
	id: string;
	name: string;
	slug: string;
	is_active: boolean;
	business_categories: { id: string; name: string }[];
	directory_count: number;
	created_at: Date;
	updated_at: Date;
}

const DUPLICATE_KEY = 11000;

const toSlug = (v: string): string => slugify(v, { lower: true, strict: true });

const businessCategoriesOf = async (ids: Types.ObjectId[]): Promise<Map<string, string>> => {
	if (!ids.length) return new Map();
	const rows = await BusinessCategory.find({ _id: { $in: ids } }).select({ name: 1 }).lean<{ _id: Types.ObjectId; name: string }[]>();
	return new Map(rows.map((r) => [String(r._id), r.name]));
};

const checkBusinessCategories = async (ids: string[]): Promise<Types.ObjectId[]> => {
	const unique = [...new Set(ids)].map(oid);
	const found = await BusinessCategory.countDocuments({ _id: { $in: unique } });
	if (found !== unique.length) {
		throw apiErrorWithData(httpStatus.BAD_REQUEST, 'Unknown business category.', { reason: 'unknown_business_category' });
	}
	return unique;
};

export const categoryViews = async (rows: IDirectoryCategory[]): Promise<CategoryView[]> => {
	const names = await businessCategoriesOf(rows.flatMap((r) => r.business_category_ids));
	const counts = await Directory.aggregate<{ _id: Types.ObjectId; n: number }>([
		{ $match: { category_ids: { $in: rows.map((r) => r._id) } } },
		{ $unwind: '$category_ids' },
		{ $group: { _id: '$category_ids', n: { $sum: 1 } } },
	]);
	const countOf = new Map(counts.map((c) => [String(c._id), c.n]));
	return rows.map((r) => ({
		id: String(r._id),
		name: r.name,
		slug: r.slug,
		is_active: r.is_active,
		business_categories: r.business_category_ids.map((id) => ({ id: String(id), name: names.get(String(id)) ?? '(deleted)' })),
		directory_count: countOf.get(String(r._id)) ?? 0,
		created_at: r.created_at,
		updated_at: r.updated_at,
	}));
};

export const createCategoryService = () => {
	const list = async (): Promise<CategoryView[]> => categoryViews(await DirectoryCategory.find({}).sort({ name: 1 }).lean<IDirectoryCategory[]>());

	const getOr404 = async (id: string): Promise<IDirectoryCategory> => {
		const row = await DirectoryCategory.findById(id).lean<IDirectoryCategory>();
		if (!row) throw apiErrorWithData(httpStatus.NOT_FOUND, 'Directory category not found.', { reason: 'not_found' });
		return row;
	};

	const save = async (id: string | null, input: CategoryInput, actor: AdminActor): Promise<CategoryView> => {
		const set: Record<string, unknown> = { updated_by: oid(actor.id) };
		if (input.name !== undefined) set.name = input.name.trim();
		if (input.slug !== undefined || (id === null && input.name)) set.slug = toSlug(input.slug ?? input.name ?? '');
		if (set.slug === '') throw apiErrorWithData(httpStatus.BAD_REQUEST, 'The slug is empty.', { reason: 'invalid_slug' });
		if (input.business_category_ids !== undefined) set.business_category_ids = await checkBusinessCategories(input.business_category_ids);
		if (input.is_active !== undefined) set.is_active = input.is_active;
		try {
			if (id === null) {
				const created = await DirectoryCategory.create({ ...set, created_by: oid(actor.id) });
				return (await categoryViews([created.toObject() as IDirectoryCategory]))[0];
			}
			await getOr404(id);
			await DirectoryCategory.updateOne({ _id: oid(id) }, { $set: set });
			return (await categoryViews([await getOr404(id)]))[0];
		} catch (err) {
			if ((err as { code?: number }).code === DUPLICATE_KEY) {
				throw apiErrorWithData(httpStatus.CONFLICT, 'A category with this slug already exists.', { reason: 'slug_taken' });
			}
			throw err;
		}
	};

	/** Refused while directories use it (deactivate it instead). */
	const remove = async (id: string): Promise<{ deleted: true }> => {
		await getOr404(id);
		const used = await Directory.countDocuments({ category_ids: oid(id) });
		if (used > 0) {
			throw apiErrorWithData(httpStatus.CONFLICT, 'Directories still use this category.', { reason: 'in_use', directory_count: used });
		}
		await DirectoryCategory.deleteOne({ _id: oid(id) });
		return { deleted: true };
	};

	/** The GBP business categories for mapping (20 best by name). */
	const searchBusinessCategories = async (q: string): Promise<{ id: string; name: string }[]> => {
		const term = q.trim();
		const filter = term ? { name: new RegExp(escapeRegex(term), 'i'), is_active: true } : { is_active: true };
		const rows = await BusinessCategory.find(filter).select({ name: 1 }).sort({ name: 1 }).limit(20).lean<{ _id: Types.ObjectId; name: string }[]>();
		return rows.map((r) => ({ id: String(r._id), name: r.name }));
	};

	return { list, create: (input: CategoryInput, actor: AdminActor) => save(null, input, actor), update: (id: string, input: CategoryInput, actor: AdminActor) => save(id, input, actor), remove, searchBusinessCategories };
};

export const categoryService = createCategoryService();
