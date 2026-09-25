import mongoose, { Document, Schema, Model } from 'mongoose';
import {
	addTimestamps,
	globalQueryFilters,
	toJSON,
} from '../configs/mongoPlugins';

export interface IUserLoginTiming extends Document {
	_id: mongoose.Types.ObjectId;
	user_id: Schema.Types.ObjectId;
	token_id?: Schema.Types.ObjectId;
	time_zone: string;
	ip_address?: string;
	login_time_utc?: Date | null;
	logout_time_utc?: Date | null;
	login_time_local?: Date | null;
	logout_time_local?: Date | null;
	is_active: boolean;
	created_at: Date;
	created_by?: Schema.Types.ObjectId;
	updated_at: Date;
	updated_by?: Schema.Types.ObjectId;
	deleted_at?: Date;
	deleted_by?: Schema.Types.ObjectId;
}

const userLoginTimingSchema = new Schema<IUserLoginTiming>(
	{
		user_id: {
			type: Schema.Types.ObjectId,
			ref: 'User',
			required: true,
		},
		token_id: {
			type: Schema.Types.ObjectId,
			ref: 'UserToken',
			default: null,
		},
		time_zone: {
			type: String,
			trim: true,
			default: null,
		},
		ip_address: {
			type: String,
			trim: true,
			default: null,
		},
		login_time_utc: {
			type: Date,
			default: null,
		},
		logout_time_utc: {
			type: Date,
			default: null,
		},
		login_time_local: {
			type: Date,
			default: null,
		},
		logout_time_local: {
			type: Date,
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
		collection: 'user_login_timings',
	},
);

userLoginTimingSchema.plugin(globalQueryFilters);
userLoginTimingSchema.plugin(toJSON);
userLoginTimingSchema.plugin(addTimestamps);

export const UserLoginTiming: Model<IUserLoginTiming> =
	mongoose.model<IUserLoginTiming>('UserLoginTiming', userLoginTimingSchema);
