import mongoose, { Document, Schema, Model } from 'mongoose';
import slugify from 'slugify';
import { ApiError } from '../utils';
import httpStatus from 'http-status';
import { languageSelect } from '../constants/selectFields';
import {
	addTimestamps,
	globalQueryFilters,
	toJSON,
} from '../configs/mongoPlugins';

export interface ILanguage extends Document {
	_id: mongoose.Types.ObjectId;
	name: string;
	slug?: string;
	is_active: boolean;
	created_at: Date;
	created_by?: Schema.Types.ObjectId;
	updated_at: Date;
	updated_by?: Schema.Types.ObjectId;
	deleted_at?: Date;
	deleted_by?: Schema.Types.ObjectId;
}

interface ILanguageModel extends Model<ILanguage> {
	getById(languageId: string): Promise<ILanguage | null>;
	deleteById(languageId: string): Promise<void>;
	getAll(limit: number, offset: number): Promise<ILanguage[]>;
	updateById(
		languageId: string,
		updates: Partial<ILanguage>,
	): Promise<ILanguage | null>;
	toggleIsActiveById(languageId: string): Promise<string>;
}

const languageSchema = new Schema<ILanguage>(
	{
		name: {
			type: String,
			required: true,
			trim: true,
		},
		slug: {
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
		collection: 'languages',
	},
);

// Insert some plugins
languageSchema.plugin(globalQueryFilters);
languageSchema.plugin(toJSON);
languageSchema.plugin(addTimestamps);

// Middleware before validation
languageSchema.pre('validate', function (next) {
	if (this.name) {
		this.slug = slugify(this.name, { lower: true });
	}
	next();
});

// Static method to get Language by ID
languageSchema.statics.getById = async function (
	languageId: string,
): Promise<ILanguage | null> {
	try {
		return await this.findOne({ _id: languageId, is_active: true }).select(
			languageSelect,
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

// Static method to delete Language by ID
languageSchema.statics.deleteById = async function (
	languageId: string,
): Promise<void> {
	try {
		const language = await this.findOneAndUpdate(
			{ _id: languageId, is_active: true },
			{ is_active: false, deleted_at: new Date() },
			{ new: true },
		);
		if (!language) {
			throw new ApiError(httpStatus.NOT_FOUND, 'Language not found');
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

// Static method to get all Languages with pagination
languageSchema.statics.getAll = async function (
	limit: number,
	offset: number,
): Promise<ILanguage[]> {
	try {
		return await this.find({ is_active: true })
			.select(languageSelect)
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

// Static method to update Language by ID
languageSchema.statics.updateById = async function (
	languageId: string,
	updates: Partial<ILanguage>,
): Promise<ILanguage | null> {
	try {
		return await this.findOneAndUpdate(
			{ _id: languageId, is_active: true },
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

// Static method to toggle the is_active status of a Language by ID
languageSchema.statics.toggleIsActiveById = async function (
	languageId: string,
): Promise<string> {
	try {
		const language = await this.findOne({
			_id: languageId,
			is_active: true,
		});
		if (!language) {
			throw new ApiError(httpStatus.NOT_FOUND, 'Language not found');
		}
		language.is_active = !language.is_active;
		await language.save();
		return `Language is now ${language.is_active ? 'active' : 'inactive'}`;
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message || 'Error toggling language status',
		);
	}
};

export const Language: ILanguageModel = mongoose.model<
	ILanguage,
	ILanguageModel
>('Language', languageSchema);
