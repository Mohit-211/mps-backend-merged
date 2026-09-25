/* eslint-disable @typescript-eslint/no-explicit-any */

import mongoose, { Document, Schema, Model } from 'mongoose';
import httpStatus from 'http-status';
import { ApiError } from '../utils';

export interface IBlogCategoryMapping extends Document {
	blog_id: Schema.Types.ObjectId;
	category_id: Schema.Types.ObjectId;

	created_at: Date;
	updated_at: Date;
}

interface IBlogCategoryMappingModel
	extends Model<IBlogCategoryMapping> {
	getCategoriesByBlogId(
		blogId: string,
	): Promise<IBlogCategoryMapping[]>;

	getBlogsByCategoryId(
		categoryId: string,
	): Promise<IBlogCategoryMapping[]>;

	deleteByBlogId(blogId: string): Promise<void>;

	deleteByBlogAndCategory(
		blogId: string,
		categoryId: string,
	): Promise<void>;
}

const blogCategoryMappingSchema =
	new Schema<IBlogCategoryMapping>(
		{
			blog_id: {
				type: Schema.Types.ObjectId,
				ref: 'Blog',
				required: true,
			},

			category_id: {
				type: Schema.Types.ObjectId,
				ref: 'BlogCategory',
				required: true,
			},

			created_at: {
				type: Date,
				default: Date.now,
			},

			updated_at: {
				type: Date,
				default: Date.now,
			},
		},
		{
			collection: 'blog_category_mappings',
		},
	);

blogCategoryMappingSchema.index(
	{
		blog_id: 1,
		category_id: 1,
	},
	{
		unique: true,
	},
);

blogCategoryMappingSchema.statics.getCategoriesByBlogId =
	async function (
		blogId: string,
	): Promise<IBlogCategoryMapping[]> {
		return await this.find({
			blog_id: blogId,
		}).populate('category_id');
	};

blogCategoryMappingSchema.statics.getBlogsByCategoryId =
	async function (
		categoryId: string,
	): Promise<IBlogCategoryMapping[]> {
		return await this.find({
			category_id: categoryId,
		}).populate('blog_id');
	};

blogCategoryMappingSchema.statics.deleteByBlogId =
	async function (blogId: string): Promise<void> {
		await this.deleteMany({
			blog_id: blogId,
		});
	};

blogCategoryMappingSchema.statics.deleteByBlogAndCategory =
	async function (
		blogId: string,
		categoryId: string,
	): Promise<void> {
		await this.deleteOne({
			blog_id: blogId,
			category_id: categoryId,
		});
	};

export const BlogCategoryMapping =
	mongoose.model<
		IBlogCategoryMapping,
		IBlogCategoryMappingModel
	>(
		'BlogCategoryMapping',
		blogCategoryMappingSchema,
	);