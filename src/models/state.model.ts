import mongoose, { Document, Schema, Model } from 'mongoose';
import { ApiError } from '../utils';
import httpStatus from 'http-status';
import { stateSelect } from '../constants';
import {
	addTimestamps,
	globalQueryFilters,
	toJSON,
} from '../configs/mongoPlugins';

export interface IState extends Document {
	name: string;
	country_id: Schema.Types.ObjectId;
	country_code: string;
	state_code: string;
	is_active: boolean;
	created_at: Date;
	created_by?: Schema.Types.ObjectId;
	updated_at: Date;
	updated_by?: Schema.Types.ObjectId;
	deleted_at?: Date;
	deleted_by?: Schema.Types.ObjectId;
}

interface IStateModel extends Model<IState> {
	getById(stateId: string): Promise<IState | null>;
	deleteById(stateId: string): Promise<void>;
	getAll(limit: number, offset: number): Promise<IState[]>;
	updateById(
		stateId: string,
		updates: Partial<IState>,
	): Promise<IState | null>;
	toggleIsActiveById(stateId: string): Promise<string>;
}

const stateSchema = new Schema<IState>(
	{
		name: {
			type: String,
			required: true,
			trim: true,
		},
		country_id: {
			type: Schema.Types.ObjectId,
			ref: 'Country',
		},
		country_code: {
			type: String,
			trime: true,
			required: true,
		},
		state_code: {
			type: String,
			trime: true,
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
		collection: 'states',
	},
);

stateSchema.plugin(globalQueryFilters);
stateSchema.plugin(toJSON);
stateSchema.plugin(addTimestamps);

stateSchema.statics.getById = async function (
	stateId: string,
): Promise<IState | null> {
	try {
		return await this.findOne({ _id: stateId, is_active: true }).select(
			stateSelect,
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

stateSchema.statics.deleteById = async function (
	stateId: string,
): Promise<void> {
	try {
		const state = await this.findOneAndUpdate(
			{ _id: stateId, is_active: true },
			{ is_active: false, deleted_at: new Date() },
			{ new: true },
		);
		if (!state) {
			throw new ApiError(httpStatus.NOT_FOUND, 'State not found');
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

stateSchema.statics.getAll = async function (
	limit: number,
	offset: number,
): Promise<IState[]> {
	try {
		return await this.find({ is_active: true })
			.select(stateSelect)
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

stateSchema.statics.updateById = async function (
	stateId: string,
	updates: Partial<IState>,
): Promise<IState | null> {
	try {
		return await this.findOneAndUpdate(
			{ _id: stateId, is_active: true },
			updates,
			{ new: true },
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

stateSchema.statics.toggleIsActiveById = async function (
	stateId: string,
): Promise<string> {
	try {
		const state = await this.findOne({ _id: stateId, is_active: true });
		if (!state) {
			throw new ApiError(httpStatus.NOT_FOUND, 'State not found');
		}
		state.is_active = !state.is_active;
		await state.save();
		return `State is now ${state.is_active ? 'active' : 'inactive'}`;
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message || 'Error toggling state status',
		);
	}
};

export const State: IStateModel = mongoose.model<IState, IStateModel>(
	'State',
	stateSchema,
);
