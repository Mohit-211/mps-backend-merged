import mongoose, { Document, Schema, Model } from 'mongoose';
import { ApiError } from '../utils';
import httpStatus from 'http-status';
import { citySelect } from '../constants';
import {
	addTimestamps,
	globalQueryFilters,
	toJSON,
} from '../configs/mongoPlugins';

export interface ICity extends Document {
	name: string;
	country_id: Schema.Types.ObjectId;
	country_code: string;
	state_id: Schema.Types.ObjectId;
	state_code: string;
	is_active: boolean;
	created_at: Date;
	created_by?: Schema.Types.ObjectId;
	updated_at: Date;
	updated_by?: Schema.Types.ObjectId;
	deleted_at?: Date;
	deleted_by?: Schema.Types.ObjectId;
}

interface ICityModel extends Model<ICity> {
	getById(cityId: string): Promise<ICity | null>;
	deleteById(cityId: string): Promise<void>;
	getAll(limit: number, offset: number): Promise<ICity[]>;
	updateById(cityId: string, updates: Partial<ICity>): Promise<ICity | null>;
	toggleIsActiveById(cityId: string): Promise<string>;
}

const citySchema = new Schema<ICity>(
	{
		name: {
			type: String,
			required: true,
			trim: true,
		},
		country_id: {
			type: Schema.Types.ObjectId,
			ref: 'Country',
			required: true,
		},
		country_code: {
			type: String,
			trime: true,
			required: true,
		},
		state_id: {
			type: Schema.Types.ObjectId,
			ref: 'State',
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
		collection: 'cities',
	},
);


citySchema.plugin(globalQueryFilters);
citySchema.plugin(toJSON);
citySchema.plugin(addTimestamps);

citySchema.statics.getById = async function (
	cityId: string,
): Promise<ICity | null> {
	try {
		return await this.findOne({ _id: cityId, is_active: true }).select(
			citySelect,
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


citySchema.statics.deleteById = async function (cityId: string): Promise<void> {
	try {
		const city = await this.findOneAndUpdate(
			{ _id: cityId, is_active: true },
			{ is_active: false, deleted_at: new Date() },
			{ new: true },
		);
		if (!city) {
			throw new ApiError(httpStatus.NOT_FOUND, 'City not found');
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


citySchema.statics.getAll = async function (
	limit: number,
	offset: number,
): Promise<ICity[]> {
	try {
		return await this.find({ is_active: true })
			.select(citySelect)
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


citySchema.statics.updateById = async function (
	cityId: string,
	updates: Partial<ICity>,
): Promise<ICity | null> {
	try {
		return await this.findOneAndUpdate(
			{ _id: cityId, is_active: true },
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

citySchema.statics.toggleIsActiveById = async function (
	cityId: string,
): Promise<string> {
	try {
		const city = await this.findOne({ _id: cityId, is_active: true });
		if (!city) {
			throw new ApiError(httpStatus.NOT_FOUND, 'City not found');
		}
		city.is_active = !city.is_active;
		await city.save();
		return `City is now ${city.is_active ? 'active' : 'inactive'}`;
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message || 'Error toggling city status',
		);
	}
};

export const City: ICityModel = mongoose.model<ICity, ICityModel>(
	'City',
	citySchema,
);
