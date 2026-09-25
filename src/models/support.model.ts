import mongoose, { Model, Document, Schema } from 'mongoose';
import { ApiError } from '../utils';
import httpStatus from 'http-status';
import { addTimestamps, globalQueryFilters, toJSON } from '../configs/mongoPlugins';
import { supportSelect } from '../constants';
import { ticketStatusTypes, ticketStatusTypesArr } from '../configs/constantTypes';

export interface ISupport extends Document {
	name: string;
	email: string;
	mobile?: string;
	address?: string;
	subject: string;
	message?: string;
	is_active: boolean;
	status: string;
	created_at: Date;
	user_id?: Schema.Types.ObjectId;
	created_by?: Schema.Types.ObjectId;
	updated_at: Date;
	updated_by?: Schema.Types.ObjectId;
	deleted_at?: Date;
	deleted_by?: Schema.Types.ObjectId;
};

interface IModelSupport extends Model<ISupport> {
	getById(supportId: string): Promise<ISupport | null>;
	deleteById(supportId: string): Promise<void>;
	getAll(limit: number, offset: number): Promise<ISupport[]>;
	toggleIsActiveById(supportId: string): Promise<string>
}

const supportSchema = new mongoose.Schema<ISupport>(
	{
		name: {
			type: String,
			trim: true,
			required: true,
		},
		user_id: {
			type: Schema.Types.ObjectId,
			default: null,
		},
		email: {
			type: String,
			trim: true,
			required: true,
		},
		mobile: {
			type: String,
			trim: true,
			default: null,
		},
		address: {
			type: String,
			trim: true,
			default: null,
		},
		subject: {
			type: String,
			trim: true,
			required: true,
		},
		message: {
			type: String,
			trim: true,
			default: null,
		},
		is_active: {
			type: Boolean,
			default: true,
		},
		status: {
			type: String,
			enum: ticketStatusTypesArr,
			default: ticketStatusTypes.OPEN,
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
		collection: 'supports'
	}
);

supportSchema.plugin(globalQueryFilters);
supportSchema.plugin(toJSON);
supportSchema.plugin(addTimestamps);

supportSchema.statics.getById = async function (
	supportId: string,
): Promise<ISupport | null> {
	try {
		return await this.findOne({ _id: supportId, is_active: true });
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

supportSchema.statics.deleteById = async function (supportId: string): Promise<void> {
	try {
		const support = await this.findOneAndUpdate(
			{ _id: supportId, is_active: true },
			{ is_active: false, deleted_at: new Date() },
			{ new: true },
		);
		if (!support) {
			throw new ApiError(httpStatus.NOT_FOUND, 'Support not found');
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

supportSchema.statics.getAll = async function (
	limit: number,
	offset: number,
): Promise<ISupport[]> {
	try {
		return await this.find({ is_active: true })
			.select(supportSelect)
			.limit(limit)
			.skip(offset)
			.sort({ created_at: -1 });
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

supportSchema.statics.toggleIsActiveById = async function (
	supportId: string,
): Promise<string> {
	try {
		const support = await this.findOne({ _id: supportId, is_active: true });
		if (!support) {
			throw new ApiError(httpStatus.NOT_FOUND, 'Country not found');
		}
		support.is_active = !support.is_active;
		await support.save();
		return `Country is now ${support.is_active ? 'active' : 'inactive'}`;
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message || 'Error toggling support status',
		);
	}
};

export const Support: IModelSupport = mongoose.model<ISupport, IModelSupport>('Support', supportSchema)