/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose, { Document, Schema, Model } from 'mongoose';
import { ApiError } from '../utils';
import httpStatus from 'http-status';
import {
	addTimestamps,
	globalQueryFilters,
	toJSON,
} from '../configs/mongoPlugins';
import { faqSelect } from '../constants';

export interface IFaq extends Document {
	question: string | null;
	answer: string | null;
	is_active: boolean;
	created_at: Date;
	created_by?: Schema.Types.ObjectId;
	updated_at: Date;
	updated_by?: Schema.Types.ObjectId;
	deleted_at?: Date;
	deleted_by?: Schema.Types.ObjectId;
}

interface IFaqModel extends Model<IFaq> {
	getById(faqId: string): Promise<IFaq | null>;
	deleteById(faqId: string): Promise<void>;
	getAll(limit: number, offset: number): Promise<IFaq[]>;
	updateById(faqId: string, updates: Partial<IFaq>): Promise<IFaq | null>;
	toggleIsActiveById(faqId: string): Promise<string>;
}

const faqSchema = new Schema<IFaq>(
	{
		question: {
			type: String,
			required: true,
		},
		answer: {
			type: String,
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
		collection: 'faqs',
	},
);

faqSchema.plugin(globalQueryFilters);
faqSchema.plugin(toJSON);
faqSchema.plugin(addTimestamps);

faqSchema.statics.getById = async function (
	faqId: string,
): Promise<IFaq | null> {
	try {
		return await this.findOne({ _id: faqId, is_active: true });
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

faqSchema.statics.deleteById = async function (faqId: string): Promise<void> {
	try {
		const faq = await this.findOneAndUpdate(
			{ _id: faqId, is_active: true },
			{ is_active: false, deleted_at: new Date() },
			{ new: true },
		);
		if (!faq) {
			throw new ApiError(httpStatus.NOT_FOUND, 'FAQ not found');
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

faqSchema.statics.getAll = async function (
	limit: number,
	offset: number,
): Promise<IFaq[]> {
	try {
		return await this.find({ is_active: true })
			.select(faqSelect)
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

faqSchema.statics.updateById = async function (
	faqId: string,
	updates: Partial<IFaq>,
): Promise<IFaq | null> {
	try {
		return await this.findOneAndUpdate(
			{ _id: faqId, is_active: true },
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

faqSchema.statics.toggleIsActiveById = async function (
	faqId: string,
): Promise<string> {
	try {
		const faq = await this.findOne({ _id: faqId, is_active: true });
		if (!faq) {
			throw new ApiError(httpStatus.NOT_FOUND, 'FAQ not found');
		}
		faq.is_active = !faq.is_active;
		await faq.save();
		return `FAQ is now ${faq.is_active ? 'active' : 'inactive'}`;
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message || 'Error toggling FAQ status',
		);
	}
};

export const Faq: IFaqModel = mongoose.model<IFaq, IFaqModel>('Faq', faqSchema);
