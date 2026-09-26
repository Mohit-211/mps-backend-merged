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
	/** Google place ID from the profile's metadata.placeId (null if Google has none). */
	place_id?: string | null;
	/** The connection (Google account, id_token sub) that bound this profile; null before Phase 7a. */
	google_sub?: string | null;
	bound_at?: Date | null;
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
		place_id: { type: String, trim: true, default: null },
		google_sub: { type: String, default: null },
		bound_at: { type: Date, default: null },
		title: {
			type: String,
			trim: true,
			default: null,
		},
		websiteUri: {
			type: String,
			trim: true,
			default: null,
		},
		languageCode: {
			type: String,
			trim: true,
			default: null,
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

// One active binding per Location, and a user binds each GBP location at most once.
userGBPSchema.index(
	{ location_id: 1 },
	{ unique: true, partialFilterExpression: { is_active: true }, name: 'location_active_binding_unique' },
);
userGBPSchema.index(
	{ user_id: 1, gbpLocationId: 1 },
	{ unique: true, partialFilterExpression: { is_active: true }, name: 'user_gbp_location_active_unique' },
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