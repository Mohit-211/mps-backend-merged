/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose, { Document, Model, Schema } from 'mongoose';
import httpStatus from 'http-status';
import { ApiError } from '../utils';
import {
	addTimestamps,
	globalQueryFilters,
	toJSON,
} from '../configs/mongoPlugins';

export interface IAdmin extends Document {
	_id: mongoose.Types.ObjectId;
	role_id?: number;
	department_id?: number;
	name?: string;
	email: string;
	password?: string;
	socket_id?: string;
	remember_token?: string;
	otp?: string;
	is_otp_valid: boolean;
	is_active: boolean;
	created_at: Date;
	updated_at: Date;
	updated_by?: Schema.Types.ObjectId;
	deleted_at?: Date;
	deleted_by?: Schema.Types.ObjectId;
}

interface IAdminModel extends Model<IAdmin> {
	isEmailTaken(email: string): Promise<boolean>;
	toggleIsActiveById(adminId: string): Promise<string>;
}

const adminSchema = new Schema<IAdmin>(
	{
		role_id: {
			type: Number,
			default: null,
		},
		name: {
			type: String,
			trim: true,
			maxlength: 200,
			default: null,
		},
		email: {
			type: String,
			trim: true,
			lowercase: true,
			required: true,
			maxlength: 100,
		},
		password: {
			type: String,
			trim: true,
			default: null,
		},
		socket_id: {
			type: String,
			trim: true,
			default: null,
		},
		remember_token: {
			type: String,
			trim: true,
			default: null,
		},
		otp: {
			type: String,
			trim: true,
			default: null,
			set(value: string | null) {
				if (!value) {
					this.set('is_otp_valid', false);
				} else {
					this.set('is_otp_valid', true);
				}
				return value;
			},
		},
		is_otp_valid: {
			type: Boolean,
			default: true,
		},
		is_active: {
			type: Boolean,
			default: true,
		},
		created_at: {
			type: Date,
			default: Date.now,
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
		collection: 'admins',
	},
);

// ✅ Add reusable plugins
adminSchema.plugin(globalQueryFilters);
adminSchema.plugin(toJSON);
adminSchema.plugin(addTimestamps);


adminSchema.post('save', async function (admin: IAdmin, next) {
	if (!admin.socket_id) {
		admin.socket_id = `${admin.role_id}-${admin._id}-${admin.department_id}-socketId`;
		try {
			await admin.save();
		} catch (error) {
			return next(error);
		}
	}
	next();
});

// ✅ Static: check if email exists
adminSchema.statics.isEmailTaken = async function (email: string) {
	const admin = await this.findOne({ email, is_active: true });
	return !!admin;
};

// ✅ Static: toggle active status
adminSchema.statics.toggleIsActiveById = async function (
	adminId: string,
): Promise<string> {
	try {
		const admin = await this.findById(adminId);
		if (!admin) throw new ApiError(httpStatus.NOT_FOUND, 'Admin not found');
		admin.is_active = !admin.is_active;
		await admin.save();
		return `Admin is now ${admin.is_active ? 'active' : 'inactive'}`;
	} catch (error: any) {
		throw new ApiError(
			error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
			error.message || 'Error toggling admin status',
		);
	}
};

// ✅ Middleware: update timestamps
adminSchema.pre('save', function (next) {
	this.updated_at = new Date();
	next();
});


adminSchema.pre('deleteOne', { document: true, query: false }, function (next) {
	this.set({
		deleted_at: new Date(),
		is_active: false,
	});
	next();
});

export const Admin: IAdminModel = mongoose.model<IAdmin, IAdminModel>(
	'Admin',
	adminSchema,
);
