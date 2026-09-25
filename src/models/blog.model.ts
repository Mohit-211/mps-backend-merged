/* eslint-disable @typescript-eslint/no-explicit-any */

import mongoose, { Document, Schema, Model } from 'mongoose';
import httpStatus from 'http-status';
import { ApiError } from '../utils';
import {
	addTimestamps,
	globalQueryFilters,
	toJSON,
} from '../configs/mongoPlugins';

export interface IBlog extends Document {
	name: string;
	slug: string;

	short_description: string;
	content: string;

	date: Date;

	author: string;
	author_position?: string;

	main_image?: string;

	is_active: boolean;

	created_at: Date;
	updated_at: Date;

	created_by?: Schema.Types.ObjectId;
	updated_by?: Schema.Types.ObjectId;

	deleted_at?: Date;
	deleted_by?: Schema.Types.ObjectId;
}

interface IBlogModel extends Model<IBlog> {
	getById(blogId: string): Promise<IBlog | null>;

	getBySlug(slug: string): Promise<IBlog | null>;

	getAll(
		limit: number,
		offset: number,
		search?: string,
	): Promise<IBlog[]>;

	deleteById(blogId: string): Promise<void>;
}

const blogSchema = new Schema<IBlog>(
	{
		name: {
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

		short_description: {
			type: String,
			required: true,
			trim: true,
		},

		// CKEditor HTML content
		content: {
			type: String,
			required: true,
		},

		date: {
			type: Date,
			required: true,
		},

		author: {
			type: String,
			required: true,
			trim: true,
		},

		author_position: {
			type: String,
			default: null,
			trim: true,
		},

		main_image: {
			type: String,
			default: null,
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
		collection: 'blogs',
	},
);

blogSchema.index(
	{ slug: 1 },
	{
		unique: true,
		partialFilterExpression: {
			is_active: true,
		},
	},
);

blogSchema.plugin(globalQueryFilters);
blogSchema.plugin(toJSON);
blogSchema.plugin(addTimestamps);

blogSchema.statics.getById = async function (
	blogId: string,
): Promise<IBlog | null> {
	try {
		return await this.findOne({
			_id: blogId,
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

blogSchema.statics.getBySlug = async function (
	slug: string,
): Promise<IBlog | null> {
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

blogSchema.statics.getAll = async function (
	limit: number,
	offset: number,
	search?: string,
): Promise<IBlog[]> {
	try {
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

		return await this.find(filter)
			.limit(limit)
			.skip(offset)
			.sort({
				date: -1,
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

blogSchema.statics.deleteById = async function (
	blogId: string,
): Promise<void> {
	try {
		const blog = await this.findOneAndUpdate(
			{
				_id: blogId,
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

		if (!blog) {
			throw new ApiError(
				httpStatus.NOT_FOUND,
				'Blog not found',
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

export const Blog = mongoose.model<IBlog, IBlogModel>(
	'Blog',
	blogSchema,
);