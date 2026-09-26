import { Document, Model, Schema, Types, model } from 'mongoose';

// Membership (Phase 8): a user's role in an organization. A client_user (agency only) sees only the
// locations of the clients in client_ids, read-only.

export const MEMBERSHIP_ROLES = ['owner', 'member', 'client_user'] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export interface IMembership extends Document {
	organization_id: Types.ObjectId;
	user_id: Types.ObjectId;
	role: MembershipRole;
	client_ids: Types.ObjectId[];
	status: 'active' | 'removed';
	created_by: Types.ObjectId | null;
	created_at: Date;
	updated_at: Date;
}

const MembershipSchema = new Schema<IMembership>(
	{
		organization_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
		user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
		role: { type: String, enum: MEMBERSHIP_ROLES, required: true },
		client_ids: { type: [Schema.Types.ObjectId], ref: 'Client', default: [] },
		status: { type: String, enum: ['active', 'removed'], default: 'active' },
		created_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
	},
	{ collection: 'memberships', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);
MembershipSchema.index({ organization_id: 1, user_id: 1 }, { unique: true });
MembershipSchema.index({ user_id: 1, status: 1 });

export const Membership: Model<IMembership> = model<IMembership>('Membership', MembershipSchema);
