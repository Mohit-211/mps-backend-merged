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

/** Agency white-label for reports and report emails (Phase 12). Business organizations use the default branding. */
export interface OrganizationBranding {
	agency_name: string | null;
	/** The logo file in REPORTS_STORAGE_DIR/branding/<organization_id>/ (private). */
	logo: { file: string; mime: 'image/png' | 'image/jpeg'; bytes: number; sha256: string } | null;
	primary_color: string | null;
	secondary_color: string | null;
	footer_text: string | null;
	contact_text: string | null;
	hide_mypageseo: boolean;
	email_sender_name: string | null;
	email_reply_to: string | null;
	updated_at: Date | null;
}

/** Invoice details (Phase 13a), editable by the owner (PATCH /billing/details). */
export interface OrganizationBillingDetails {
	name: string | null;
	email: string | null;
	address_line1: string | null;
	address_line2: string | null;
	city: string | null;
	region: string | null;
	postal_code: string | null;
	country: string | null;
}

export interface IOrganization extends Document {
	name: string;
	type: OrganizationType;
	country: OrganizationCountry | null;
	owner_user_id: Types.ObjectId;
	onboarding: { completed_at: Date | null; skipped: SkippableStep[] };
	branding?: OrganizationBranding | null;
	/** Phase 13a billing: trial end (set at creation), the plan (standard or custom), how it pays. */
	trial_ends_at?: Date | null;
	plan_id?: Types.ObjectId | null;
	billing_method?: 'paypal' | 'manual';
	billing_details?: OrganizationBillingDetails | null;
	token_balance?: number;
	/** Phase 13b: an admin suspension makes the organization read-only. */
	suspended_at?: Date | null;
	suspended_reason?: string | null;
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
		branding: { type: Schema.Types.Mixed, default: null },
		trial_ends_at: { type: Date, default: null },
		plan_id: { type: Schema.Types.ObjectId, ref: 'BillingPlan', default: null },
		billing_method: { type: String, enum: ['paypal', 'manual'], default: 'paypal' },
		billing_details: { type: Schema.Types.Mixed, default: null },
		token_balance: { type: Number, default: 0 },
		suspended_at: { type: Date, default: null },
		suspended_reason: { type: String, default: null },
		is_active: { type: Boolean, default: true },
	},
	{ collection: 'organizations', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);
OrganizationSchema.index({ owner_user_id: 1 });

export const Organization: Model<IOrganization> = model<IOrganization>('Organization', OrganizationSchema);
