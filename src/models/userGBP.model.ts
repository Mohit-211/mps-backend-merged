import mongoose, { Document, Schema, Model } from 'mongoose';
import { ApiError } from '../utils';
import httpStatus from 'http-status';
import {
	addTimestamps,
	globalQueryFilters,
	toJSON,
} from '../configs/mongoPlugins';

export interface IUserGBP extends Document {
	user_id: Schema.Types.ObjectId;
	location_id: Schema.Types.ObjectId;
	gbpAccountId: string;
	gbpLocationId: string;	
	title?: string;
	websiteUri?: string;
	languageCode?: string;
	metadata?: object;
	profile?: object;
	is_active: boolean;
	created_at: Date;
	created_by?: Schema.Types.ObjectId;
	updated_at: Date;
	updated_by?: Schema.Types.ObjectId;
	deleted_at?: Date;
	deleted_by?: Schema.Types.ObjectId;
}

interface IUserGBPModel extends Model<IUserGBP> {
	toggleIsActiveById(userGBPId: string): Promise<string>;
}

const userGBPSchema = new Schema<IUserGBP>(
	{
		user_id: {
			type: Schema.Types.ObjectId,
			ref: 'User',
			required: true,
		},
		location_id: {
            type: Schema.Types.ObjectId,
            ref: 'Location',
            required: true
		},
		gbpAccountId: {
			type: String,
			trim: true,
			required: true,
		},
		gbpLocationId: {
			type: String,
			trim: true,
			required: true,
		},
		title: {
			type: String,
			trim: true,
			required: true,
		},
		websiteUri: {
			type: String,
			trim: true,
			required: true,
		},
		languageCode: {
			type: String,
			trim: true,
			required: true,
		},
		metadata: {
			type: Object,
			default: null,
		},
		profile: {
			type: Object,
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
		collection: 'userGBPs',
	},
);

userGBPSchema.plugin(globalQueryFilters);
userGBPSchema.plugin(toJSON);
userGBPSchema.plugin(addTimestamps);

userGBPSchema.statics.toggleIsActiveById = async function (
	userGBPId: string,
): Promise<string> {
	try {
		const userGBP = await this.findOne({ _id: userGBPId, is_active: true });
		if (!userGBP) {
			throw new ApiError(httpStatus.NOT_FOUND, 'UserGBP not found');
		}
		userGBP.is_active = !userGBP.is_active;
		await userGBP.save();
		return `UserGBP is now ${userGBP.is_active ? 'active' : 'inactive'}`;
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message || 'Error toggling userGBP status',
		);
	}
};

export const UserGBP: IUserGBPModel = mongoose.model<IUserGBP, IUserGBPModel>(
	'UserGBP',
	userGBPSchema,
);