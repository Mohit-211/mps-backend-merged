/* eslint-disable @typescript-eslint/no-explicit-any */

import httpStatus from 'http-status';
import slugify from 'slugify';
import {
	Blog,
	BlogCategory,
	BlogCategoryMapping,
} from '../../models';
import { ApiError, mongoFunctions } from '../../utils';
import { mongoOperationsTypes } from '../../configs/constantTypes';

export const createBlog = async (
	reqBody: any,
	files: any,
): Promise<any> => {
	try {
		const {
			name,
			short_description,
			content,
			date,
			author,
			author_position,
		} = reqBody;

		if (
			!name ||
			!short_description ||
			!content ||
			!date ||
			!author
		) {
			throw new ApiError(
				httpStatus.BAD_REQUEST,
				'Name, short description, content, date and author are required.',
			);
		}

		// ==========================================
		// Generate slug from blog name
		// ==========================================

		const slug = slugify(name, {
			lower: true,
			strict: true,
			trim: true,
		});

		// ==========================================
		// Check duplicate slug
		// ==========================================

		const existingBlog = await Blog.findOne({
			slug,
			is_active: true,
		});

		if (existingBlog) {
			throw new ApiError(
				httpStatus.BAD_REQUEST,
				'A blog with this name already exists.',
			);
		}

		// ==========================================
		// Parse category IDs
		// ==========================================

		let categoryIds: string[] = [];

		if (reqBody.category_ids) {
			try {
				categoryIds =
					typeof reqBody.category_ids === 'string'
						? JSON.parse(reqBody.category_ids)
						: reqBody.category_ids;

				if (!Array.isArray(categoryIds)) {
					categoryIds = [categoryIds];
				}
			} catch (error) {
				throw new ApiError(
					httpStatus.BAD_REQUEST,
					'Invalid category_ids format.',
				);
			}
		}

		// ==========================================
		// Validate categories
		// ==========================================

		if (categoryIds.length > 0) {
			const categories =
				await BlogCategory.find({
					_id: {
						$in: categoryIds,
					},
					is_active: true,
				});

			if (categories.length !== categoryIds.length) {
				throw new ApiError(
					httpStatus.BAD_REQUEST,
					'One or more blog categories are invalid.',
				);
			}
		}

		// ==========================================
		// Main image
		// ==========================================

		let mainImage = null;

		if (
			files &&
			Object.keys(files).length !== 0 &&
			files.images &&
			files.images.length !== 0
		) {
			const currImage = files.images[0];

			mainImage = `/images/${currImage.filename}`;
		}

		// ==========================================
		// Create Blog
		// ==========================================

		const blog = await mongoFunctions({
			schema: Blog,
			createData: {
				name,
				slug,
				short_description,
				content,
				date,
				author,
				author_position,
				main_image: mainImage,
			},
			operationType: mongoOperationsTypes.CREATE,
		});

		if (!blog) {
			throw new ApiError(
				httpStatus.INTERNAL_SERVER_ERROR,
				'Failed to create blog.',
			);
		}

		// ==========================================
		// Create Category Mappings
		// ==========================================

		if (categoryIds.length > 0) {
			const mappingData = categoryIds.map(
				(categoryId: string) => ({
					blog_id: blog._id,
					category_id: categoryId,
				}),
			);

			await BlogCategoryMapping.insertMany(mappingData);
		}

		return await getBlogById(blog._id.toString());
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

export const getAllBlogs = async (
	queryParams: any,
): Promise<any> => {
	try {
		const page = Number(queryParams.page) || 1;
		const limit = Number(queryParams.limit) || 10;
		const offset = (page - 1) * limit;

		const search = queryParams.search || '';
		const categoryId = queryParams.category_id || '';

		const filter: any = {
			is_active: true,
		};

		if (search) {
			filter.$or = [
				{
					name: {
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
				{
					author: {
						$regex: search,
						$options: 'i',
					},
				},
			];
		}

		if (categoryId) {
			const mappings =
				await BlogCategoryMapping.find({
					category_id: categoryId,
				});

			const blogIds = mappings.map(
				(mapping) => mapping.blog_id,
			);

			filter._id = {
				$in: blogIds,
			};
		}

		const totalResults =
			await Blog.countDocuments(filter);

		const results = await Blog.find(filter)
			.limit(limit)
			.skip(offset)
			.sort({
				date: -1,
			})
			.lean();

		const blogWithCategories = await Promise.all(
			results.map(async (blog) => {
				const mappings =
					await BlogCategoryMapping.find({
						blog_id: blog._id,
					}).populate('category_id');

				return {
					...blog,
					categories: mappings.map(
						(mapping: any) =>
							mapping.category_id,
					),
				};
			}),
		);

		return {
			results: blogWithCategories,
			page,
			limit,
			totalPages: Math.ceil(
				totalResults / limit,
			),
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

export const getBlogById = async (
	blogId: string,
): Promise<any> => {
	try {
		const blog = await Blog.getById(blogId);

		if (!blog) {
			throw new ApiError(
				httpStatus.NOT_FOUND,
				'Blog not found.',
			);
		}

		const mappings =
			await BlogCategoryMapping.find({
				blog_id: blogId,
			}).populate('category_id');

		return {
			...blog.toJSON(),
			categories: mappings.map(
				(mapping: any) =>
					mapping.category_id,
			),
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

export const getBlogBySlug = async (
	slug: string,
): Promise<any> => {
	try {
		const blog = await Blog.getBySlug(slug);

		if (!blog) {
			throw new ApiError(
				httpStatus.NOT_FOUND,
				'Blog not found.',
			);
		}

		return await getBlogById(
			blog._id.toString(),
		);
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

export const updateBlog = async (
	blogId: string,
	reqBody: any,
	files: any,
): Promise<any> => {
	try {
		const blog = await Blog.getById(blogId);

		if (!blog) {
			throw new ApiError(
				httpStatus.NOT_FOUND,
				'Blog not found.',
			);
		}

		const {
			name,
			short_description,
			content,
			date,
			author,
			author_position,
		} = reqBody;

		// ==========================================
		// Generate new slug if name changes
		// ==========================================

		if (name && name !== blog.name) {
			const slug = slugify(name, {
				lower: true,
				strict: true,
				trim: true,
			});

			const existingBlog =
				await Blog.findOne({
					slug,
					_id: {
						$ne: blogId,
					},
					is_active: true,
				});

			if (existingBlog) {
				throw new ApiError(
					httpStatus.BAD_REQUEST,
					'A blog with this name already exists.',
				);
			}

			blog.name = name;
			blog.slug = slug;
		}

		// ==========================================
		// Update normal fields
		// ==========================================

		if (
			short_description &&
			short_description !== 'undefined'
		) {
			blog.short_description =
				short_description;
		}

		if (
			content &&
			content !== 'undefined'
		) {
			blog.content = content;
		}

		if (date && date !== 'undefined') {
			blog.date = date;
		}

		if (
			author &&
			author !== 'undefined'
		) {
			blog.author = author;
		}

		if (
			author_position &&
			author_position !== 'undefined'
		) {
			blog.author_position =
				author_position;
		}

		// ==========================================
		// Update main image if new image uploaded
		// ==========================================

		if (
			files &&
			Object.keys(files).length !== 0 &&
			files.images &&
			files.images.length !== 0
		) {
			const currImage = files.images[0];

			blog.main_image =
				`/images/${currImage.filename}`;
		}

		// ==========================================
		// Save blog
		// ==========================================

		await blog.save();

		// ==========================================
		// Parse category IDs
		// ==========================================

		let categoryIds: string[] | null = null;

		if (reqBody.category_ids !== undefined) {
			try {
				categoryIds =
					typeof reqBody.category_ids ===
					'string'
						? JSON.parse(
								reqBody.category_ids,
							)
						: reqBody.category_ids;

				if (!Array.isArray(categoryIds)) {
					categoryIds = [categoryIds];
				}
			} catch (error) {
				throw new ApiError(
					httpStatus.BAD_REQUEST,
					'Invalid category_ids format.',
				);
			}
		}

		// ==========================================
		// Update category mappings
		// ==========================================

		if (Array.isArray(categoryIds)) {
			const categories =
				await BlogCategory.find({
					_id: {
						$in: categoryIds,
					},
					is_active: true,
				});

			if (
				categories.length !==
				categoryIds.length
			) {
				throw new ApiError(
					httpStatus.BAD_REQUEST,
					'One or more blog categories are invalid.',
				);
			}

			await BlogCategoryMapping.deleteMany({
				blog_id: blogId,
			});

			if (categoryIds.length > 0) {
				await BlogCategoryMapping.insertMany(
					categoryIds.map(
						(categoryId: string) => ({
							blog_id: blogId,
							category_id:
								categoryId,
						}),
					),
				);
			}
		}

		return await getBlogById(blogId);
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

export const deleteBlog = async (
	blogId: string,
): Promise<void> => {
	try {
		await Blog.deleteById(blogId);

		await BlogCategoryMapping.deleteByBlogId(
			blogId,
		);
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};