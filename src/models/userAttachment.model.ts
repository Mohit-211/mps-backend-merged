import mongoose, { Document, Schema, Model } from 'mongoose';
import {
	addTimestamps,
	globalQueryFilters,
	toJSON,
} from '../configs/mongoPlugins';

export interface IUserAttachment extends Document {
	user_id: mongoose.Types.ObjectId;
	title: string;
	file_type: string;
	file_name: string;
	file_uri: string;
	file_size?: string;
	is_active: boolean;
	created_at: Date;
	created_by?: Schema.Types.ObjectId;
	updated_at: Date;
	updated_by?: Schema.Types.ObjectId;
	deleted_at?: Date;
	deleted_by?: Schema.Types.ObjectId;
}

const userAttachmentSchema = new Schema<IUserAttachment>(
	{
		user_id: {
			type: Schema.Types.ObjectId,
			ref: 'User',
			required: true,
		},
		title: {
			type: String,
			trim: true,
			required: true,
		},
		file_type: {
			type: String,
			trim: true,
			required: true,
		},
		file_name: {
			type: String,
			required: true,
		},
		file_uri: {
			type: String,
			required: true,
		},
		file_size: {
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
		collection: 'user_attachments',
	},
);

userAttachmentSchema.plugin(globalQueryFilters);
userAttachmentSchema.plugin(toJSON);
userAttachmentSchema.plugin(addTimestamps);

export const UserAttachment: Model<IUserAttachment> =
	mongoose.model<IUserAttachment>('UserAttachment', userAttachmentSchema);
