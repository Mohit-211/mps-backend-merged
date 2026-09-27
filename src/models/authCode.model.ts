import { Document, Model, Schema, Types, model } from 'mongoose';

// One-time auth codes (Phase 8): password reset codes (an HMAC of the 6-digit code) and, since Phase 8.1,
// email verification links (purpose verify_email: a SHA-256 of the link token). Rows expire (TTL index)
// and are single-use.

export const AUTH_CODE_PURPOSES = ['verify_email', 'reset_password'] as const;
export type AuthCodePurpose = (typeof AUTH_CODE_PURPOSES)[number];

export interface IAuthCode extends Document {
	user_id: Types.ObjectId;
	purpose: AuthCodePurpose;
	code_hash: string;
	expires_at: Date;
	attempts: number;
	max_attempts: number;
	consumed_at: Date | null;
	created_at: Date;
}

const AuthCodeSchema = new Schema<IAuthCode>(
	{
		user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
		purpose: { type: String, enum: AUTH_CODE_PURPOSES, required: true },
		code_hash: { type: String, required: true },
		expires_at: { type: Date, required: true },
		attempts: { type: Number, default: 0 },
		max_attempts: { type: Number, default: 5 },
		consumed_at: { type: Date, default: null },
	},
	{ collection: 'auth_codes', timestamps: { createdAt: 'created_at', updatedAt: false } },
);
// One active code per user and purpose; expired documents are removed by MongoDB.
AuthCodeSchema.index({ user_id: 1, purpose: 1 }, { unique: true });
AuthCodeSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });
// Phase 8.1: verification links are looked up by their hash.
AuthCodeSchema.index({ purpose: 1, code_hash: 1 });

export const AuthCode: Model<IAuthCode> = model<IAuthCode>('AuthCode', AuthCodeSchema);
