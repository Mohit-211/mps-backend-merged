/* eslint-disable @typescript-eslint/no-explicit-any */

import mongoose, { Document, Schema, Model } from 'mongoose';
import httpStatus from 'http-status';
import { ApiError } from '../utils';
import {
	addTimestamps,
	globalQueryFilters,
	toJSON,
} from '../configs/mongoPlugins';

export interface IBlogCategory extends Document {
	title: string;
	slug: string;

	is_active: boolean;

	created_at: Date;
	updated_at: Date;

	created_by?: Schema.Types.ObjectId;
	updated_by?: Schema.Types.ObjectId;

	deleted_at?: Date;
	deleted_by?: Schema.Types.ObjectId;
}

interface IBlogCategoryModel extends Model<IBlogCategory> {
	getById(categoryId: string): Promise<IBlogCategory | null>;

	getBySlug(slug: string): Promise<IBlogCategory | null>;

	getAll(
		limit: number,
		offset: number,
		search?: string,
	): Promise<IBlogCategory[]>;

	deleteById(categoryId: string): Promise<void>;
}

const blogCategorySchema = new Schema<IBlogCategory>(
	{
		title: {
			type: String,
			required: true,
			trim: true,
		},

		slug: {
			type: String,
			required: true,
			trim: true,
			lowercase: true,
		},

		is_active: {
			type: Boolean,
			default: true,
		},

		created_at: {
			type: Date,
			default: Date.now,
		},

		updated_at: {
			type: Date,
			default: Date.now,
		},

		created_by: {
			type: Schema.Types.ObjectId,
			default: null,
		},

		updated_by: {
			type: Schema.Types.ObjectId,
			default: null,
		},

		deleted_at: {
			type: Date,
			default: null,
		},

		deleted_by: {
			type: Schema.Types.ObjectId,
			default: null,
		},
	},
	{
		collection: 'blog_categories',
	},
);

blogCategorySchema.index(
	{ slug: 1 },
	{
		unique: true,
		partialFilterExpression: {
			is_active: true,
		},
	},
);

blogCategorySchema.plugin(globalQueryFilters);
blogCategorySchema.plugin(toJSON);
blogCategorySchema.plugin(addTimestamps);

blogCategorySchema.statics.getById = async function (
	categoryId: string,
): Promise<IBlogCategory | null> {
	try {
		return await this.findOne({
			_id: categoryId,
			is_active: true,
		});
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

blogCategorySchema.statics.getBySlug = async function (
	slug: string,
): Promise<IBlogCategory | null> {
	try {
		return await this.findOne({
			slug,
			is_active: true,
		});
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

blogCategorySchema.statics.getAll = async function (
	limit: number,
	offset: number,
	search?: string,
): Promise<IBlogCategory[]> {
	try {
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

		return await this.find(filter)
			.limit(limit)
			.skip(offset)
			.sort({
				created_at: -1,
			});
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

blogCategorySchema.statics.deleteById = async function (
	categoryId: string,
): Promise<void> {
	try {
		const category = await this.findOneAndUpdate(
			{
				_id: categoryId,
				is_active: true,
			},
			{
				is_active: false,
				deleted_at: new Date(),
			},
			{
				new: true,
			},
		);

		if (!category) {
			throw new ApiError(
				httpStatus.NOT_FOUND,
				'Blog category not found',
			);
		}
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

export const BlogCategory = mongoose.model<
	IBlogCategory,
	IBlogCategoryModel
>('BlogCategory', blogCategorySchema);