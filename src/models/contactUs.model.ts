/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose, { Document, Schema, Model } from 'mongoose';
import httpStatus from 'http-status';
import { ApiError } from '../utils';
import {
	addTimestamps,
	globalQueryFilters,
	toJSON,
} from '../configs/mongoPlugins';

export interface IContactUs extends Document {
	full_name: string;
	business_name: string;
	email: string;
	phone_number?: string;
	business_website?: string;
	business_location?: string;
	company_size: string;
	primary_interest: string;
	goals_or_challenges: string;

	status: 'NEW' | 'CONTACTED' | 'CLOSED' | 'IN_PROGRESS';

	is_active: boolean;

	created_at: Date;
	updated_at: Date;

	created_by?: Schema.Types.ObjectId;
	updated_by?: Schema.Types.ObjectId;
	deleted_at?: Date;
	deleted_by?: Schema.Types.ObjectId;
}

interface IContactUsModel extends Model<IContactUs> {
	getById(contactId: string): Promise<IContactUs | null>;

	getAll(
		limit: number,
		offset: number,
		search?: string,
		status?: string,
	): Promise<IContactUs[]>;

	updateStatusById(
		contactId: string,
		status: string,
	): Promise<IContactUs | null>;

	deleteById(contactId: string): Promise<void>;
}

const contactUsSchema = new Schema<IContactUs>(
	{
		full_name: {
			type: String,
			required: true,
			trim: true,
		},

		business_name: {
			type: String,
			required: true,
			trim: true,
		},

		email: {
			type: String,
			required: true,
			lowercase: true,
			trim: true,
		},

		phone_number: {
			type: String,
			default: null,
		},

		business_website: {
			type: String,
			default: null,
		},

		business_location: {
			type: String,
			default: null,
		},

		company_size: {
			type: String,
			required: true,
		},

		primary_interest: {
			type: String,
			required: true,
		},

		goals_or_challenges: {
			type: String,
			required: true,
		},
		status: {
			type: String,
			enum: ['NEW', 'IN_PROGRESS', 'CONTACTED', 'CLOSED'],
			default: 'NEW',
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
		collection: 'contact_us',
	},
);

contactUsSchema.plugin(globalQueryFilters);
contactUsSchema.plugin(toJSON);
contactUsSchema.plugin(addTimestamps);

contactUsSchema.statics.getById = async function (
	contactId: string,
): Promise<IContactUs | null> {
	try {
		return await this.findOne({
			_id: contactId,
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

contactUsSchema.statics.getAll = async function (
	limit: number,
	offset: number,
	search?: string,
	status?: string,
): Promise<IContactUs[]> {
	try {
		const filter: any = {
			is_active: true,
		};

		if (status) {
			filter.status = status;
		}

		if (search) {
			filter.$or = [
				{
					full_name: {
						$regex: search,
						$options: 'i',
					},
				},
				{
					business_name: {
						$regex: search,
						$options: 'i',
					},
				},
				{
					email: {
						$regex: search,
						$options: 'i',
					},
				},
			];
		}

		return await this.find(filter).limit(limit).skip(offset).sort({
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

contactUsSchema.statics.updateStatusById = async function (
	contactId: string,
	status: string,
): Promise<IContactUs | null> {
	try {
		return await this.findOneAndUpdate(
			{
				_id: contactId,
				is_active: true,
			},
			{
				status,
			},
			{
				new: true,
			},
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

contactUsSchema.statics.deleteById = async function (
	contactId: string,
): Promise<void> {
	try {
		const contact = await this.findOneAndUpdate(
			{
				_id: contactId,
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

		if (!contact) {
			throw new ApiError(
				httpStatus.NOT_FOUND,
				'Contact request not found',
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

export const ContactUs = mongoose.model<IContactUs, IContactUsModel>(
	'ContactUs',
	contactUsSchema,
);
