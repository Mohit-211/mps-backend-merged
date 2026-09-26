import { Document, Model, Schema, Types, model } from 'mongoose';

// One-time OAuth `state` values (CLAUDE.md §10, AUDIT S11). Only a SHA-256 hash of the random state
// is stored; the callback consumes it atomically and resolves user_id server-side. Mongo's TTL
// monitor deletes rows after expires_at.

export const OAUTH_STATE_PURPOSES = ['gbp'] as const;
export type OAuthStatePurpose = (typeof OAUTH_STATE_PURPOSES)[number];

export interface IOAuthState extends Document {
	token_hash: string;
	user_id: Types.ObjectId;
	purpose: OAuthStatePurpose;
	expires_at: Date;
	used_at: Date | null;
	created_at: Date;
}

const OAuthStateSchema = new Schema<IOAuthState>(
	{
		token_hash: { type: String, required: true },
		user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
		purpose: { type: String, enum: OAUTH_STATE_PURPOSES, required: true },
		expires_at: { type: Date, required: true },
		used_at: { type: Date, default: null },
		created_at: { type: Date, default: Date.now },
	},
	{ collection: 'oauth_states' },
);

OAuthStateSchema.index({ token_hash: 1 }, { unique: true });
OAuthStateSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export const OAuthState: Model<IOAuthState> = model<IOAuthState>('OAuthState', OAuthStateSchema);
