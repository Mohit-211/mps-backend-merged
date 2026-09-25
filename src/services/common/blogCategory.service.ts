/* eslint-disable @typescript-eslint/no-explicit-any */

import httpStatus from 'http-status';
import { BlogCategory } from '../../models';
import { ApiError, mongoFunctions } from '../../utils';
import { mongoOperationsTypes } from '../../configs/constantTypes';
import slugify from 'slugify';

export const createBlogCategory = async (
	reqBody: any,
): Promise<any> => {
	try {
		const { title } = reqBody;

		if (!title) {
			throw new ApiError(
				httpStatus.BAD_REQUEST,
				'Title is required.',
			);
		}

		const slug = slugify(title, {
			lower: true,
			strict: true,
			trim: true,
		});

		const existingCategory = await BlogCategory.findOne({
			slug,
			is_active: true,
		});

		if (existingCategory) {
			throw new ApiError(
				httpStatus.BAD_REQUEST,
				'A blog category with this title already exists.',
			);
		}

		const category = await mongoFunctions({
			schema: BlogCategory,
			createData: {
				title,
				slug,
			},
			operationType: mongoOperationsTypes.CREATE,
		});

		return category;
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

export const getAllBlogCategories = async (
	queryParams: any,
): Promise<any> => {
	try {
		const page = Number(queryParams.page) || 1;
		const limit = Number(queryParams.limit) || 10;
		const offset = (page - 1) * limit;

		const search = queryParams.search || '';

		const filter: any = {
			is_active: true,
		};

		if (search) {
			filter.$or = [
				{
					title: {
						$regex: search,
						$options: 'i',
					},
				},
				{
					slug: {
						$regex: search,
						$options: 'i',
					},
				},
			];
		}

		const totalResults =
			await BlogCategory.countDocuments(filter);

		const results = await BlogCategory.getAll(
			limit,
			offset,
			search,
		);

		return {
			results,
			page,
			limit,
			totalPages: Math.ceil(totalResults / limit),
			totalResults,
		};
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

export const getBlogCategoryById = async (
	categoryId: string,
): Promise<any> => {
	try {
		const category = await BlogCategory.getById(categoryId);

		if (!category) {
			throw new ApiError(
				httpStatus.NOT_FOUND,
				'Blog category not found.',
			);
		}

		return category;
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

export const updateBlogCategory = async (
	categoryId: string,
	reqBody: any,
): Promise<any> => {
	try {
		const category = await BlogCategory.getById(categoryId);

		if (!category) {
			throw new ApiError(
				httpStatus.NOT_FOUND,
				'Blog category not found.',
			);
		}

		const { title } = reqBody;

		if (!title) {
			throw new ApiError(
				httpStatus.BAD_REQUEST,
				'Title is required.',
			);
		}

		const slug = slugify(title, {
			lower: true,
			strict: true,
			trim: true,
		});

		const existingCategory = await BlogCategory.findOne({
			slug,
			_id: {
				$ne: categoryId,
			},
			is_active: true,
		});

		if (existingCategory) {
			throw new ApiError(
				httpStatus.BAD_REQUEST,
				'A blog category with this title already exists.',
			);
		}

		category.title = title;
		category.slug = slug;

		await category.save();

		return category;
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

export const deleteBlogCategory = async (
	categoryId: string,
): Promise<void> => {
	try {
		await BlogCategory.deleteById(categoryId);
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};