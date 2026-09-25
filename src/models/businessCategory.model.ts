import mongoose, { Document, Model, Schema } from 'mongoose';
import { ApiError } from '../utils';
import httpStatus from 'http-status';
import { businessCategorySelect } from '../constants';
import {
	addTimestamps,
	globalQueryFilters,
	toJSON,
} from '../configs/mongoPlugins';

export interface IBusinessCategory extends Document {
	name: string;
	slug: string;
	is_active: boolean;
	created_at: Date;
	created_by?: Schema.Types.ObjectId;
	updated_at: Date;
	updated_by?: Schema.Types.ObjectId;
	deleted_at?: Date;
	deleted_by?: Schema.Types.ObjectId;
}

interface IBusinessCategoryModel extends Model<IBusinessCategory> {
	getById(businessCategoryId: string): Promise<IBusinessCategory | null>;
	deleteById(businessCategoryId: string): Promise<void>;
	getAll(limit: number, offset: number): Promise<IBusinessCategory[]>;
	updateById(businessCategoryId: string, updates: Partial<IBusinessCategory>): Promise<IBusinessCategory | null>;
	toggleIsActiveById(businessCategoryId: string): Promise<string>;
}

const businessCategorySchema = new Schema<IBusinessCategory>(
	{
		name: {
			type: String,
			trim: true,
			required: true,
		},
		slug: {
			type: String,
			trim: true,
			required: true,
		},
		is_active: {
			type: Boolean,
			default: true,
		},
		created_at: {
			type: Date,
			default: Date.now,
		},
		created_by: {
			type: Schema.Types.ObjectId,
			default: null,
		},
		updated_at: {
			type: Date,
			default: Date.now,
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
		collection: 'business_categorys',
	},
);

businessCategorySchema.plugin(globalQueryFilters);
businessCategorySchema.plugin(toJSON);
businessCategorySchema.plugin(addTimestamps);

businessCategorySchema.statics.getById = async function (
	businessCategoryId: string,
): Promise<IBusinessCategory | null> {
	try {
		return await this.findOne({ _id: businessCategoryId, is_active: true }).select(
			businessCategorySelect,
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

businessCategorySchema.statics.deleteById = async function (businessCategoryId: string): Promise<void> {
	try {
		const businessCategory = await this.findOneAndUpdate(
			{ _id: businessCategoryId, is_active: true },
			{ is_active: false, deleted_at: new Date() },
			{ new: true },
		);
		if (!businessCategory) {
			throw new ApiError(httpStatus.NOT_FOUND, 'BusinessCategory not found');
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

businessCategorySchema.statics.getAll = async function (
	limit: number,
	offset: number,
): Promise<IBusinessCategory[]> {
	try {
		return await this.find({ is_active: true })
			.select(businessCategorySelect)
			.limit(limit)
			.skip(offset)
			.sort({ name: 1 });
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

businessCategorySchema.statics.updateById = async function (
	businessCategoryId: string,
	updates: Partial<IBusinessCategory>,
): Promise<IBusinessCategory | null> {
	try {
		if (!updates.name || !updates.slug) {
			throw new ApiError(
				httpStatus.BAD_REQUEST,
				'Name and Slug both needed.',
			);
		}
		const businessCategoryDoc = await this.findOne({
			_id: businessCategoryId,
			is_active: true,
		});
		if (!businessCategoryDoc) {
			throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid businessCategoryId');
		}
		businessCategoryDoc.name = updates.name;
		businessCategoryDoc.slug = updates.slug;
		await businessCategoryDoc.save();
		return businessCategoryDoc;
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

businessCategorySchema.statics.toggleIsActiveById = async function (
	businessCategoryId: string,
): Promise<string> {
	try {
		const businessCategory = await this.findOne({ _id: businessCategoryId, is_active: true });
		if (!businessCategory) {
			throw new ApiError(httpStatus.NOT_FOUND, 'BusinessCategory not found');
		}
		businessCategory.is_active = !businessCategory.is_active;
		await businessCategory.save();
		return `BusinessCategory is now ${businessCategory.is_active ? 'active' : 'inactive'}`;
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message || 'Error toggling businessCategory status',
		);
	}
};

export const BusinessCategory: IBusinessCategoryModel = mongoose.model<IBusinessCategory, IBusinessCategoryModel>(
	'BusinessCategory',
	businessCategorySchema,
);
