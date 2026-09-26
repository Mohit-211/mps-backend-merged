import { Document, Model, Schema, Types, model } from 'mongoose';

// Team invitations (Phase 11). Only a SHA-256 hash of the 32-byte token is stored; invitations expire
// after INVITATION_TTL_DAYS and work once. Documents are kept as history (accepted / revoked / expired).

export const INVITATION_ROLES = ['member', 'client_user'] as const;
export type InvitationRole = (typeof INVITATION_ROLES)[number];
export type InvitationStatus = 'pending' | 'accepted' | 'revoked';

export interface IInvitation extends Document {
	organization_id: Types.ObjectId;
	email: string;
	role: InvitationRole;
	client_ids: Types.ObjectId[];
	token_hash: string;
	expires_at: Date;
	status: InvitationStatus;
	invited_by: Types.ObjectId;
	accepted_by: Types.ObjectId | null;
	accepted_at: Date | null;
	created_at: Date;
	updated_at: Date;
}

const InvitationSchema = new Schema<IInvitation>(
	{
		organization_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
		email: { type: String, required: true, lowercase: true, trim: true },
		role: { type: String, enum: INVITATION_ROLES, required: true },
		client_ids: { type: [Schema.Types.ObjectId], ref: 'Client', default: [] },
		token_hash: { type: String, required: true },
		expires_at: { type: Date, required: true },
		status: { type: String, enum: ['pending', 'accepted', 'revoked'], default: 'pending' },
		invited_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
		accepted_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
		accepted_at: { type: Date, default: null },
	},
	{ collection: 'invitations', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);
InvitationSchema.index({ token_hash: 1 }, { unique: true });
InvitationSchema.index({ organization_id: 1, email: 1 }, { unique: true, partialFilterExpression: { status: 'pending' }, name: 'one_pending_invitation_per_email' });
InvitationSchema.index({ organization_id: 1, created_at: -1 });

export const Invitation: Model<IInvitation> = model<IInvitation>('Invitation', InvitationSchema);
