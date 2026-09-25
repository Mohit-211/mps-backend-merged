import { Document, Schema, Model, model, Types } from 'mongoose';
import { tokenTypes, tokenTypesArr } from '../configs/constantTypes';
import {
	addTimestamps,
	globalQueryFilters,
	toJSON,
} from '../configs/mongoPlugins';

export interface IUserAuth extends Document {
	user_id: Schema.Types.ObjectId;
	token_type: string;
	access_token: string;
	refresh_token: string;
	expiry_date: Date;
	is_active: boolean;
	created_at: Date;
	created_by?: Schema.Types.ObjectId;
	updated_at: Date;
	updated_by?: Schema.Types.ObjectId;
	deleted_at?: Date;
	deleted_by?: Schema.Types.ObjectId;
}

const UserAuthSchema = new Schema<IUserAuth>(
	{
		user_id: {
			type: Schema.Types.ObjectId,
			ref: 'User',
			required: true,
		},
		token_type: {
			type: String,
			enum: tokenTypesArr,
			default: tokenTypes.ANALYTICS,
		},
		access_token: {
			type: String,
			trim: true,
			required: true,
		},
        refresh_token: {
			type: String,
			trim: true,
			required: true,
		},
		expiry_date: {
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
		collection: 'user_auths',
	},
);

UserAuthSchema.plugin(globalQueryFilters);
UserAuthSchema.plugin(toJSON);
UserAuthSchema.plugin(addTimestamps);

export const UserAuth: Model<IUserAuth> = model<IUserAuth>(
	'UserAuth',
	UserAuthSchema,
);
