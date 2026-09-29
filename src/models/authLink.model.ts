import { Document, Model, Schema, Types, model } from 'mongoose';

// One-time links (13b; replaces the Phase 8 AuthCode codes). The link carries a random 32-byte token; only
// its SHA-256 is stored. One row per subject and purpose, so issuing a new link replaces (invalidates) the
// older one. A row is kept until purge_at (a week after it expires or is used), so an old link can still
// answer "expired" or "already used" instead of "unknown".
//   verify_email      user: signup email verification (Phase 8.1)
//   reset_password    user or admin: forgot password
//   set_password      admin: the first password of a new admin account

export const AUTH_LINK_PURPOSES = ['verify_email', 'reset_password', 'set_password'] as const;
export type AuthLinkPurpose = (typeof AUTH_LINK_PURPOSES)[number];
export const AUTH_LINK_SUBJECTS = ['user', 'admin'] as const;
export type AuthLinkSubject = (typeof AUTH_LINK_SUBJECTS)[number];

export interface IAuthLink extends Document {
	subject_kind: AuthLinkSubject;
	subject_id: Types.ObjectId;
	purpose: AuthLinkPurpose;
	token_hash: string;
	expires_at: Date;
	consumed_at: Date | null;
	purge_at: Date;
	created_at: Date;
}

const AuthLinkSchema = new Schema<IAuthLink>(
	{
		subject_kind: { type: String, enum: AUTH_LINK_SUBJECTS, required: true },
		subject_id: { type: Schema.Types.ObjectId, required: true },
		purpose: { type: String, enum: AUTH_LINK_PURPOSES, required: true },
		token_hash: { type: String, required: true },
		expires_at: { type: Date, required: true },
		consumed_at: { type: Date, default: null },
		purge_at: { type: Date, required: true },
	},
	{ collection: 'auth_links', timestamps: { createdAt: 'created_at', updatedAt: false } },
);
AuthLinkSchema.index({ subject_kind: 1, subject_id: 1, purpose: 1 }, { unique: true });
AuthLinkSchema.index({ purpose: 1, token_hash: 1 });
AuthLinkSchema.index({ purge_at: 1 }, { expireAfterSeconds: 0 });

export const AuthLink: Model<IAuthLink> = model<IAuthLink>('AuthLink', AuthLinkSchema);
