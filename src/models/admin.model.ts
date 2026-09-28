import mongoose, { Document, Model, Schema } from 'mongoose';

// Platform admin accounts (Phase 10; 13b: no OTP fields, a new admin sets the first password through an
// emailed link, so password is null until then and such an account can't sign in).
// token_version revokes every admin token issued before it was incremented (password change or reset, role
// or email change, deactivation). Admins are deactivated, never deleted, so audit entries keep their author.

export interface IAdmin extends Document {
	_id: mongoose.Types.ObjectId;
	role_id?: number;
	name?: string;
	email: string;
	password?: string | null;
	token_version?: number;
	is_active: boolean;
	last_login_at?: Date | null;
	created_by?: mongoose.Types.ObjectId | null;
	created_at: Date;
	updated_at: Date;
}

const adminSchema = new Schema<IAdmin>(
	{
		role_id: { type: Number, default: null },
		name: { type: String, trim: true, maxlength: 200, default: null },
		email: { type: String, trim: true, lowercase: true, required: true, maxlength: 100 },
		password: { type: String, default: null },
		token_version: { type: Number, default: 0 },
		is_active: { type: Boolean, default: true },
		last_login_at: { type: Date, default: null },
		created_by: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
	},
	{ collection: 'admins', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);
adminSchema.index({ email: 1 }, { unique: true });

export const Admin: Model<IAdmin> = mongoose.model<IAdmin>('Admin', adminSchema);
