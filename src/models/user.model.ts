/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose, { Document, Model, Schema } from 'mongoose';
import httpStatus from 'http-status';
import {
	userStatusTypes,
	userStatusTypesArr,
	userTypesArr,
} from '../configs/constantTypes';
import config from '../configs/config';
import {
	addTimestamps,
	globalQueryFilters,
	toJSON,
} from '../configs/mongoPlugins';
import { ApiError } from '../utils';

export interface IUser extends Document {
	_id: mongoose.Types.ObjectId;
	user_type?: string;
	email: string;
	role_id: number;
	owner_id?: Schema.Types.ObjectId;
	password: string;
	status: string;
	is_gbp_connected: boolean;
	notification_status: boolean;

	/** Phase 8: the organization used when no X-Organization-Id header is sent. */
	default_organization_id?: mongoose.Types.ObjectId | null;
	/** Phase 10: the `tv` claim of every user token; incrementing it revokes all issued tokens. */
	token_version?: number;
	/** Phase 8.1: when the email was verified (null = not verified: no login, no tokens). */
	email_verified_at?: Date | null;
	/** Phase 8.1: set only by POST /auth/signup; an account still unverified after it is deleted. */
	verification_deadline?: Date | null;
	is_active: boolean;
	created_at: Date;
	created_by?: Schema.Types.ObjectId;
	updated_at: Date;
	updated_by?: Schema.Types.ObjectId;
	deleted_at?: Date;
	deleted_by?: Schema.Types.ObjectId;
	comparePassword(candidatePassword: string): Promise<boolean>;
}
interface IUserModel extends Model<IUser> {
	isEmailTaken(email: string): Promise<boolean>;
	toggleIsActiveById(userId: string): Promise<string>;
}

const userSchema = new Schema<IUser>(
	{
		user_type: {
			type: String,
			enum: userTypesArr,
			default: null,
		},
		email: {
			type: String,
			trim: true,
			lowercase: true,
			maxlength: 200,
			required: true,
		},
		role_id: {
			type: Number,
			default: config.roles.user,
			required: true,
		},
		owner_id: {
			type: Schema.Types.ObjectId,
			default: null,
			required: false,
		},
		password: {
			type: String,
			trim: true,
			required: true,
		},
		status: {
			type: String,
			enum: userStatusTypesArr,
			default: userStatusTypes.PENDING,
		},
		is_gbp_connected: {
			type: Boolean,
			default: false,
		},
		notification_status: {
			type: Boolean,
			default: true,
		},

		default_organization_id: {
			type: Schema.Types.ObjectId,
			ref: 'Organization',
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
		token_version: { type: Number, default: 0 },
		email_verified_at: { type: Date, default: null },
		verification_deadline: { type: Date, default: null },
		deleted_by: {
			type: Schema.Types.ObjectId,
			default: null,
		},
	},
	{
		collection: 'users',
	},
);

// Phase 8.1: the unverified-cleanup job's query (only signups carry a deadline).
userSchema.index({ verification_deadline: 1 }, { partialFilterExpression: { verification_deadline: { $type: 'date' } } });

userSchema.plugin(globalQueryFilters);
userSchema.plugin(toJSON);
userSchema.plugin(addTimestamps);

userSchema.statics.isEmailTaken = async function (email: string) {
	const user = await this.findOne({ email, is_active: true });
	return !!user;
};

userSchema.statics.toggleIsActiveById = async function (
	userId: string,
): Promise<string> {
	try {
		const user = await this.findOne({ _id: userId, is_active: true });
		if (!user) {
			throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
		}
		user.is_active = !user.is_active;
		await user.save();
		return `User is now ${user.is_active ? 'active' : 'inactive'}`;
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message || 'Error toggling user status',
		);
	}
};

export const User: IUserModel = mongoose.model<IUser, IUserModel>(
	'User',
	userSchema,
);
