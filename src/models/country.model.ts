import mongoose, { Document, Schema, Model } from 'mongoose';
import { ApiError } from '../utils';
import httpStatus from 'http-status';
import { countrySelect } from '../constants';
import {
	addTimestamps,
	globalQueryFilters,
	toJSON,
} from '../configs/mongoPlugins';

export interface ICountry extends Document {
	_id: mongoose.Types.ObjectId;
	name: string;
	currency?: string;
	unicodeFlag?: string;
	capital?: string;
	flag?: string;
	dialCode?: string;
	iso2?: string;
	iso3?: string;
	is_active: boolean;
	created_at: Date;
	created_by?: Schema.Types.ObjectId;
	updated_at: Date;
	updated_by?: Schema.Types.ObjectId;
	deleted_at?: Date;
	deleted_by?: Schema.Types.ObjectId;
}

interface ICountryModel extends Model<ICountry> {
	getById(countryId: string): Promise<ICountry | null>;
	deleteById(countryId: string): Promise<void>;
	getAll(limit: number, offset: number): Promise<ICountry[]>;
	updateById(
		countryId: string,
		updates: Partial<ICountry>,
	): Promise<ICountry | null>;
	toggleIsActiveById(countryId: string): Promise<string>;
}

const countrySchema = new Schema<ICountry>(
	{
		name: {
			type: String,
			required: true,
			trim: true,
		},
		currency: {
			type: String,
			trim: true,
			default: null,
		},
		unicodeFlag: {
			type: String,
			trim: true,
			default: null,
		},
		capital: {
			type: String,
			trim: true,
			default: null,
		},
		flag: {
			type: String,
			trim: true,
			default: null,
		},
		dialCode: {
			type: String,
			trim: true,
			default: null,
		},
		iso2: {
			type: String,
			trim: true,
			default: null,
		},
		iso3: {
			type: String,
			trim: true,
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
		collection: 'countries',
	},
);

countrySchema.plugin(globalQueryFilters);
countrySchema.plugin(toJSON);
countrySchema.plugin(addTimestamps);

countrySchema.statics.getById = async function (
	countryId: string,
): Promise<ICountry | null> {
	try {
		return await this.findOne({ _id: countryId, is_active: true }).select(
			countrySelect,
		);
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message || 'Error retrieving country',
		);
	}
};

countrySchema.statics.deleteById = async function (
	countryId: string,
): Promise<void> {
	try {
		const country = await this.findOneAndUpdate(
			{ _id: countryId, is_active: true },
			{ is_active: false, deleted_at: new Date() },
			{ new: true },
		);
		if (!country) {
			throw new ApiError(httpStatus.NOT_FOUND, 'Country not found');
		}
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message || 'Error deleting country',
		);
	}
};

countrySchema.statics.getAll = async function (
	limit: number,
	offset: number,
): Promise<ICountry[]> {
	try {
		return await this.find({ is_active: true })
			.select(countrySelect)
			.limit(limit)
			.skip(offset)
			.sort({ name: 1 });
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message || 'Error retrieving countries',
		);
	}
};

countrySchema.statics.updateById = async function (
	countryId: string,
	updates: Partial<ICountry>,
): Promise<ICountry | null> {
	try {
		return await this.findOneAndUpdate(
			{ _id: countryId, is_active: true },
			updates,
			{ new: true },
		);
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message || 'Error updating country',
		);
	}
};

countrySchema.statics.toggleIsActiveById = async function (
	countryId: string,
): Promise<string> {
	try {
		const country = await this.findOne({ _id: countryId, is_active: true });
		if (!country) {
			throw new ApiError(httpStatus.NOT_FOUND, 'Country not found');
		}
		country.is_active = !country.is_active;
		await country.save();
		return `Country is now ${country.is_active ? 'active' : 'inactive'}`;
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message || 'Error toggling country status',
		);
	}
};

export const Country: ICountryModel = mongoose.model<ICountry, ICountryModel>(
	'Country',
	countrySchema,
);