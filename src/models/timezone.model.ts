/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose, { Document, Model, Schema } from 'mongoose';
import { ApiError } from '../utils';
import httpStatus from 'http-status';
import { timezoneSelect } from '../constants';
import {
	addTimestamps,
	globalQueryFilters,
	toJSON,
} from '../configs/mongoPlugins';

export interface ITimezone extends Document {
	_id: mongoose.Types.ObjectId;
	time_zone: string;
	has_day_light_saving: boolean;
	is_day_light_saving_active: boolean;
	is_active: boolean;
	created_at: Date;
	created_by?: Schema.Types.ObjectId;
	updated_at: Date;
	updated_by?: Schema.Types.ObjectId;
	deleted_at?: Date;
	deleted_by?: Schema.Types.ObjectId;
}

interface ITimezoneModel extends Model<ITimezone> {
	getById(timezoneId: string): Promise<ITimezone | null>;
	deleteById(timezoneId: string): Promise<void>;
	getAll(limit: number, offset: number): Promise<ITimezone[]>;
	updateById(
		timezoneId: string,
		updates: Partial<ITimezone>,
	): Promise<ITimezone | null>;
	toggleIsActiveById(timezoneId: string): Promise<string>;
}

const timezoneSchema = new Schema<ITimezone>(
	{
		time_zone: {
			type: String,
			trim: true,
			required: true,
		},
		has_day_light_saving: {
			type: Boolean,
			required: true,
		},
		is_day_light_saving_active: {
			type: Boolean,
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
		collection: 'timezones',
	},
);

timezoneSchema.plugin(globalQueryFilters);
timezoneSchema.plugin(toJSON);
timezoneSchema.plugin(addTimestamps);

timezoneSchema.statics.getById = async function (
	timezoneId: string,
): Promise<ITimezone | null> {
	try {
		return await this.findOne({ _id: timezoneId, is_active: true }).select(
			timezoneSelect,
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

timezoneSchema.statics.deleteById = async function (
	timezoneId: string,
): Promise<void> {
	try {
		const timezone = await this.findOneAndUpdate(
			{ _id: timezoneId, is_active: true },
			{ is_active: false, deleted_at: new Date() },
			{ new: true },
		);
		if (!timezone) {
			throw new ApiError(httpStatus.NOT_FOUND, 'Timezone not found');
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

timezoneSchema.statics.getAll = async function (
	limit: number,
	offset: number,
): Promise<ITimezone[]> {
	try {
		return await this.find({ is_active: true })
			.select(timezoneSelect)
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

timezoneSchema.statics.updateById = async function (
	timezoneId: string,
	updates: Partial<ITimezone>,
): Promise<ITimezone | null> {
	try {
		return await this.findOneAndUpdate(
			{ _id: timezoneId, is_active: true },
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

timezoneSchema.statics.toggleIsActiveById = async function (
	timezoneId: string,
): Promise<string> {
	try {
		const timezone = await this.findOne({
			_id: timezoneId,
			is_active: true,
		});
		if (!timezone) {
			throw new ApiError(httpStatus.NOT_FOUND, 'Timezone not found');
		}
		timezone.is_active = !timezone.is_active;
		await timezone.save();
		return `Timezone is now ${timezone.is_active ? 'active' : 'inactive'}`;
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message || 'Error toggling timezone status',
		);
	}
};

export const Timezone: ITimezoneModel = mongoose.model<
	ITimezone,
	ITimezoneModel
>('Timezone', timezoneSchema);
