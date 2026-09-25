import mongoose, { Document, Model, Schema } from 'mongoose';
import { ApiError } from '../utils';
import httpStatus from 'http-status';
import { whitelabelProfileSelect } from '../constants';
import {
	addTimestamps,
	globalQueryFilters,
	toJSON,
} from '../configs/mongoPlugins';
import { colors, colorsArr } from '../configs/constantTypes';

interface IReports {
	rank_tracker: boolean;
	local_search_grid: boolean;
	citation_tracker: boolean;
	citation_builder: boolean;
	reputation_manager: boolean;
	gbp_audit: boolean;
	local_search_audit: boolean;
	google_analytics: boolean;
}

const reportSchema = new Schema<IReports>({
	rank_tracker: {
			type: Boolean,
			default: false,
		},
	local_search_grid: {
			type: Boolean,
			default: false,
		},
	citation_tracker: {
			type: Boolean,
			default: false,
		},
	citation_builder: {
			type: Boolean,
			default: false,
		},
	reputation_manager: {
			type: Boolean,
			default: false,
		},
	gbp_audit: {
			type: Boolean,
			default: false,
		},
	local_search_audit: {
			type: Boolean,
			default: false,
		},
	google_analytics: {
			type: Boolean,
			default: false,
		},
});

export interface IWhitelabelProfile extends Document {
	name: string;
	header: string;
    footer: string;
	color: string;

    file_type?: string;
    file_name?: string;
    file_uri?: string;
    file_size?: string;

	external: boolean;
	external_url?: string;
	external_reports_lists?: IReports;
	location_id?: Schema.Types.ObjectId;

	client_access_restriction_for_reputation_manager: boolean;
	access_password?: string;

    is_primary: boolean;
	is_active: boolean;
	created_at: Date;
	created_by?: Schema.Types.ObjectId;
	updated_at: Date;
	updated_by?: Schema.Types.ObjectId;
	deleted_at?: Date;
	deleted_by?: Schema.Types.ObjectId;
}

interface IWhitelabelProfileModel extends Model<IWhitelabelProfile> {
	getById(whitelabelProfileId: string): Promise<IWhitelabelProfile | null>;
	deleteById(whitelabelProfileId: string): Promise<void>;
	getAll(limit: number, offset: number): Promise<IWhitelabelProfile[]>;
	updateById(whitelabelProfileId: string, updates: Partial<IWhitelabelProfile>): Promise<IWhitelabelProfile | null>;
	toggleIsActiveById(whitelabelProfileId: string): Promise<string>;
}

const whitelabelProfileSchema = new Schema<IWhitelabelProfile>(
	{
		name: {
			type: String,
			trim: true,
			required: true,
		},
		header: {
			type: String,
			trim: true,
			required: true,
		},
        footer: {
			type: String,
			trim: true,
			required: true,
		},
		color: {
			type: String,
			enum: colorsArr,
			default: colors.DEFAULT,
		},

        file_type: {
			type: String,
			trim: true,
			default: null,
		},
        file_name: {
			type: String,
			trim: true,
			default: null,
		},
        file_uri: {
			type: String,
			trim: true,
			default: null,
		},
        file_size: {
			type: String,
			trim: true,
			default: null,
		},

        is_primary: {
			type: Boolean,
			default: false,
		},

		external: {
			type: Boolean,
			default: true,
		},
		external_url: {
			type: String,
			trim: true,
			default: null,
		},
		location_id: {
			type: Schema.Types.ObjectId,
			default: null,
		},
		external_reports_lists: reportSchema,
	
		client_access_restriction_for_reputation_manager: {
			type: Boolean,
			default: false,
		},
		access_password: {
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
			ref: 'User',
			required: true,
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
		collection: 'whitelabel_profiles',
	},
);

whitelabelProfileSchema.plugin(globalQueryFilters);
whitelabelProfileSchema.plugin(toJSON);
whitelabelProfileSchema.plugin(addTimestamps);

whitelabelProfileSchema.statics.getById = async function (
	whitelabelProfileId: string,
): Promise<IWhitelabelProfile | null> {
	try {
		return await this.findOne({ _id: whitelabelProfileId, is_active: true }).select(
			whitelabelProfileSelect,
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

whitelabelProfileSchema.statics.deleteById = async function (whitelabelProfileId: string): Promise<void> {
	try {
		const whitelabelProfile = await this.findOneAndUpdate(
			{ _id: whitelabelProfileId, is_active: true },
			{ is_active: false, deleted_at: new Date() },
			{ new: true },
		);
		if (!whitelabelProfile) {
			throw new ApiError(httpStatus.NOT_FOUND, 'WhitelabelProfile not found');
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

whitelabelProfileSchema.statics.getAll = async function (
	limit: number,
	offset: number,
): Promise<IWhitelabelProfile[]> {
	try {
		return await this.find({ is_active: true })
			.select(whitelabelProfileSelect)
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

whitelabelProfileSchema.statics.toggleIsActiveById = async function (
	whitelabelProfileId: string,
): Promise<string> {
	try {
		const whitelabelProfile = await this.findOne({ _id: whitelabelProfileId, is_active: true });
		if (!whitelabelProfile) {
			throw new ApiError(httpStatus.NOT_FOUND, 'WhitelabelProfile not found');
		}
		whitelabelProfile.is_active = !whitelabelProfile.is_active;
		await whitelabelProfile.save();
		return `WhitelabelProfile is now ${whitelabelProfile.is_active ? 'active' : 'inactive'}`;
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message || 'Error toggling whitelabelProfile status',
		);
	}
};

export const WhitelabelProfile: IWhitelabelProfileModel = mongoose.model<IWhitelabelProfile, IWhitelabelProfileModel>(
	'WhitelabelProfile',
	whitelabelProfileSchema,
);
