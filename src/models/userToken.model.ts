import { Document, Schema, Model, model, Types } from 'mongoose';
import { tokenTypes, tokenTypesArr } from '../configs/constantTypes';
import {
	addTimestamps,
	globalQueryFilters,
	toJSON,
} from '../configs/mongoPlugins';

export interface IUserToken extends Document {
	user_id: Schema.Types.ObjectId;
	token_type: string;
	token: string;
	fcm_token?: string;
	expired_at?: Date | null;
	is_active: boolean;
	created_at: Date;
	created_by?: Schema.Types.ObjectId;
	updated_at: Date;
	updated_by?: Schema.Types.ObjectId;
	deleted_at?: Date;
	deleted_by?: Schema.Types.ObjectId;
}

const UserTokenSchema = new Schema<IUserToken>(
	{
		user_id: {
			type: Schema.Types.ObjectId,
			ref: 'User',
			required: true,
		},
		token_type: {
			type: String,
			enum: tokenTypesArr,
			default: tokenTypes.SESSION,
		},
		token: {
			type: String,
			trim: true,
			required: true,
		},
		fcm_token: {
			type: String,
			trim: true,
			default: null,
		},
		expired_at: {
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
		collection: 'user_tokens',
	},
);

UserTokenSchema.plugin(globalQueryFilters);
UserTokenSchema.plugin(toJSON);
UserTokenSchema.plugin(addTimestamps);

export const UserToken: Model<IUserToken> = model<IUserToken>(
	'UserToken',
	UserTokenSchema,
);
