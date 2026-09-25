import mongoose, { Document, Model, Schema } from 'mongoose';
import { addTimestamps, globalQueryFilters, toJSON } from '../configs/mongoPlugins';
import { citationOrderStatus, citationOrderStatusArr, daysOfWeek, openingHoursTypes, openingHoursTypesArr } from '../configs/constantTypes';

export interface IOpeningHoursFormat {
    day?: string;
    type?: string;
    from?: string | null;
    to?: string | null;
    split_from?: string | null;
    split_to?: string | null;
}

export interface ISocialLinks {
    facebook?: string | null;
    instagram?: string | null;
    twitter?: string | null;
    linkedin?: string | null;
    pinterest?: string | null;
}

export interface IAboutBusiness {
    category: string;
    extra_categories?: string[];
    description?: string | null;
    list_of_services?: string[];
    employees?: number;
    year_founded?: number;
}

export interface IBusinessInfo {
    name: string;
    address_line_1: string;
    address_line_2: string;
    city: string;
    region: string;
    postal_code: string;
    country: string;
    phone: string;
    website?: string | null;
    contact_first_name?: string | null;
    contact_last_name?: string | null;
    contact_email?: string | null;
    contact_phone?: string | null;
}

export interface ICampaign extends Document {
    _id: mongoose.Types.ObjectId;

    location_id?: Schema.Types.ObjectId;
    user_id?: Schema.Types.ObjectId;

    aggregators?: string[];

    status?: string;
    action_required?: boolean;
    error_message?: string | null;
    reject_message?: string | null;
    action_message?: string | null;

    is_term_accepted?: boolean;
    is_white_lable?: boolean;
    is_hide_address?: boolean;
    is_duplicate_remove?: boolean;
    manual_citation_count?: number;
    aggregators_count?: number;
    nap_updated_count?: number;
    nap_addition_count?: number;
    accepted_payment_methods?: string[];

    business_info?: {
        name: string;
        country: string;
        address_line_1: string;
        address_line_2?: string | null;
        city: string;
        region: string;
        postal_code: string;
        phone: string;
        website: string;

        contact_first_name: string;
        contact_last_name: string;
        contact_email: string;
        contact_phone: string;
        opening_date?: string | null;
    };

    about_busines?: {
        category: string;
        extra_categories: string[];
        description?: string;
        list_of_services: string[];
        employees: number;
        year_founded: number;
    };

    social_links?: {
        facebook?: string | null;
        instagram?: string | null;
        twitter?: string | null;
        linkedin?: string | null;
        pinterest?: string | null;
    };

    opening_hours?: {
        day: string;
        type: string;
        from?: string | null;
        to?: string | null;
        split_from?: string | null;
        split_to?: string | null;
    }[];

    email_alerts?: {
        enabled: boolean;
        email?: string | null;
    };

    additionalData?: {
        reference_number?: string | null;
        notes?: string | null;
    };

    images?: {
        logo_url?: string | null;
        gallery?: string[] | null;
    };

    submitted_at?: Date | null;
    verified_at?: Date | null;
    is_active: boolean;
    created_at: Date;
    created_by?: Schema.Types.ObjectId | null;
    updated_at: Date;
    updated_by?: Schema.Types.ObjectId | null;
    deleted_at?: Date | null;
    deleted_by?: Schema.Types.ObjectId | null;
}

const campaignSchema = new Schema<ICampaign>(
    {
        location_id: { type: Schema.Types.ObjectId, required: true },
        user_id: { type: Schema.Types.ObjectId, required: true },
        aggregators: { type: [String], default: [] },

        status: { type: String, enum: citationOrderStatusArr, default: citationOrderStatus.saved },
        action_required: { type: Boolean, default: false },
        error_message: { type: String, default: null },
        reject_message: { type: String, default: null },
        action_message: { type: String, default: null },

        is_term_accepted: { type: Boolean, default: true },
        is_white_lable: { type: Boolean, default: false },
        is_hide_address: { type: Boolean, default: false },
        is_duplicate_remove: { type: Boolean, default: false },
        manual_citation_count: { type: Number, required: true, default: 0 },
        aggregators_count: { type: Number, required: true, default: 0 },
        nap_updated_count: { type: Number, required: true, default: 0 },
        nap_addition_count: { type: Number, required: true, default: 0 },

        business_info: {
            type: new Schema({
                name: { type: String, required: true },
                country: { type: String, required: true },
                address_line_1: { type: String, required: true },
                address_line_2: { type: String, default: null },
                city: { type: String, required: true },
                region: { type: String, required: false, default: null },
                postal_code: { type: String, required: true },
                phone: { type: String, required: true },
                website: { type: String, required: true },

                contact_first_name: { type: String, required: true },
                contact_last_name: { type: String, required: true },
                contact_email: { type: String, required: true },
                contact_phone: { type: String, required: true },
                opening_date: { type: Date, default: null }
            }, { _id: false }),
            default: null
        },


        about_busines: {
            type: new Schema({
                category: { type: String, required: true },
                extra_categories: { type: [String], default: [] },
                description: { type: String, default: "" },
                list_of_services: { type: [String], default: [] },
                employees: { type: Number, default: 0 },
                year_founded: { type: Number, default: 0 }
            }, { _id: false }),
            default: null
        },

        social_links: {
            type: new Schema({
                facebook: { type: String, default: null },
                instagram: { type: String, default: null },
                twitter: { type: String, default: null },
                linkedin: { type: String, default: null },
                pinterest: { type: String, default: null }
            }, { _id: false }),
            default: null
        },
        accepted_payment_methods: { type: [String], required: false, default: [] },

        opening_hours: {
            type: [{
                day: { type: String, enum: daysOfWeek, default: null },
                type: { type: String, enum: openingHoursTypesArr, default: openingHoursTypes.open },
                from: { type: String, default: null },
                to: { type: String, default: null },
                split_from: { type: String, default: null },
                split_to: { type: String, default: null }
            }],
            default: null
        },

        email_alerts: {
            type: new Schema({
                enabled: { type: Boolean, default: false },
                email: { type: String, default: null }
            }, { _id: false }),
            default: null
        },

        additionalData: {
            type: new Schema({
                reference_number: { type: String, default: null },
                notes: { type: String, default: null }
            }, { _id: false }),
            default: null
        },

        images: {
            type: new Schema({
                logo_url: { type: String, default: null },
                gallery: { type: [String], default: [] }
            }, { _id: false }),
            default: null
        },

        submitted_at: { type: Date, default: null },
        verified_at: { type: Date, default: null },
        is_active: { type: Boolean, default: true },
        created_at: { type: Date, default: Date.now },
        created_by: { type: Schema.Types.ObjectId, default: null },
        updated_at: { type: Date, default: Date.now },
        updated_by: { type: Schema.Types.ObjectId, default: null },
        deleted_at: { type: Date, default: null },
        deleted_by: { type: Schema.Types.ObjectId, default: null },
    },
    {
        collection: 'campaigns',
    }
);

campaignSchema.plugin(globalQueryFilters);
campaignSchema.plugin(toJSON);
campaignSchema.plugin(addTimestamps);

export const Campaign: Model<ICampaign> = mongoose.model<ICampaign>(
    'Campaign',
    campaignSchema
);
