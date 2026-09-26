import { Document, Model, Schema, Types, model } from 'mongoose';

// Organization (Phase 8): owns locations and clients. Business or Agency. Users act in it through a
// Membership (owner / member / client_user).

export const ORGANIZATION_TYPES = ['business', 'agency'] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];
export const ORGANIZATION_COUNTRIES = ['US', 'CA'] as const;
export type OrganizationCountry = (typeof ORGANIZATION_COUNTRIES)[number];
/** Onboarding steps that can be skipped explicitly (the others are derived from data). */
export const SKIPPABLE_STEPS = ['google', 'reporting_brand'] as const;
export type SkippableStep = (typeof SKIPPABLE_STEPS)[number];

export interface IOrganization extends Document {
	name: string;
	type: OrganizationType;
	country: OrganizationCountry | null;
	owner_user_id: Types.ObjectId;
	onboarding: { completed_at: Date | null; skipped: SkippableStep[] };
	is_active: boolean;
	created_at: Date;
	updated_at: Date;
}

const OrganizationSchema = new Schema<IOrganization>(
	{
		name: { type: String, trim: true, required: true, maxlength: 150 },
		type: { type: String, enum: ORGANIZATION_TYPES, required: true },
		country: { type: String, enum: [...ORGANIZATION_COUNTRIES, null], default: null },
		owner_user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
		onboarding: {
			completed_at: { type: Date, default: null },
			skipped: { type: [String], enum: SKIPPABLE_STEPS, default: [] },
		},
		is_active: { type: Boolean, default: true },
	},
	{ collection: 'organizations', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);
OrganizationSchema.index({ owner_user_id: 1 });

export const Organization: Model<IOrganization> = model<IOrganization>('Organization', OrganizationSchema);
