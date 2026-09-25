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
	user_name?: string;
	user_type?: string;
	email: string;
	role_id: number;
	owner_id?: Schema.Types.ObjectId;
	password: string;
	stripe_customer_id?: string;
	socket_id?: string;
	referral_code?: string;
	status: string;
	is_proof_verify: boolean;
	is_analytics_connected: boolean;
	is_gbp_connected: boolean;
	available_credit: number;
	notification_status: boolean;
	fcm_token?: string;
	square_customer_id?: string;
	trial: boolean;
	subscription_status?: string;

	current_plan_id?: Schema.Types.ObjectId;
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
	isUserNameTaken(user_name: string): Promise<boolean>;
	toggleIsActiveById(userId: string): Promise<string>;
}

const userSchema = new Schema<IUser>(
	{
		user_name: {
			type: String,
			trim: true,
			maxlength: 150,
			default: null,
		},
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
		stripe_customer_id: {
			type: String,
			trim: true,
			default: null,
		},
		socket_id: {
			type: String,
			trim: true,
			default: null,
		},
		referral_code: {
			type: String,
			trim: true,
			default: null,
		},
		status: {
			type: String,
			enum: userStatusTypesArr,
			default: userStatusTypes.PENDING,
		},
		is_proof_verify: {
			type: Boolean,
			default: false,
		},
		is_analytics_connected: {
			type: Boolean,
			default: false,
		},
		is_gbp_connected: {
			type: Boolean,
			default: false,
		},
		available_credit: {
			type: Number,
			default: 0
		},
		square_customer_id: {
			type: String,
			trim: true,
			default: null,
		},
		notification_status: {
			type: Boolean,
			default: true,
		},
		trial: {
			type: Boolean,
			default: false,
		},
		subscription_status: {
			type: String,
			enum: [
				'ACTIVE',
				'CANCELLED',
			],
			default: 'ACTIVE',
		},

		current_plan_id: {
			type: Schema.Types.ObjectId,
			ref: 'SubscriptionPlan',
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
		collection: 'users',
	},
);

userSchema.plugin(globalQueryFilters);
userSchema.plugin(toJSON);
userSchema.plugin(addTimestamps);

userSchema.post('save', async function (user: IUser, next) {
	if (!user.socket_id || !user.referral_code) {
		user.socket_id = `${user.role_id}-${user._id}-socketId`;
		user.referral_code = generateRandomString(20);

		try {
			await user.save();
		} catch (error) {
			return next(error);
		}
	}
	next();
});

const generateRandomString = (length: number) => {
	const chars = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
	let result = '';
	while (result.length < length) {
		const randomChar = chars.charAt(
			Math.floor(Math.random() * chars.length),
		);
		result += randomChar;
	}
	return result;
};

userSchema.statics.isEmailTaken = async function (email: string) {
	const user = await this.findOne({ email, is_active: true });
	return !!user;
};

userSchema.statics.isUserNameTaken = async function (user_name: string) {
	const user = await this.findOne({ user_name, is_active: true });
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
