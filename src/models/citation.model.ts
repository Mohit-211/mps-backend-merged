import mongoose, { Document, Model, Schema } from 'mongoose';
import { addTimestamps, globalQueryFilters, toJSON } from '../configs/mongoPlugins';
import { citationModes, citationModesArr, citationOrderStatus, citationOrderStatusArr, citationStatus, citationStatusArr, citationTypes, citationTypesArr, currencyTypes, currencyTypesArr, paymentStatusTypes, paymentStatusTypesArr } from '../configs/constantTypes';

export interface ICitation extends Document {
    _id: mongoose.Types.ObjectId;
    location_id?: Schema.Types.ObjectId;
    campaign_id?: Schema.Types.ObjectId;
    user_id?: Schema.Types.ObjectId;
    directory_id?: Schema.Types.ObjectId;
    site_name?: string,
    business_name?: string,
    zip_code?: string,
    phone_number?: string,
    authority?: string,
    site_type?: string,
    verification_required?: string[],

    status?: string;
    citation_type?: string;
    mode?: string;
    is_harmfull?: boolean;
    is_existing?: boolean;

    action_required?: boolean;
    error_message?: string;
    reject_message?: string;
    action_message?: string;

    submitted_at?: Date;
    verified_at?: Date;
    is_active: boolean;
    created_at: Date;
    created_by?: Schema.Types.ObjectId;
    updated_at: Date;
    updated_by?: Schema.Types.ObjectId;
    deleted_at?: Date;
    deleted_by?: Schema.Types.ObjectId;
}

const citationSchema = new Schema<ICitation>(
    {
        location_id: { type: Schema.Types.ObjectId, required: true },
        campaign_id: { type: Schema.Types.ObjectId, required: true },
        user_id: { type: Schema.Types.ObjectId, required: true },
        directory_id: { type: Schema.Types.ObjectId, required: true },

        site_name: { type: String, default: null },
        business_name: { type: String, default: null },
        zip_code: { type: String, default: null },
        phone_number: { type: String, default: null },
        authority: { type: String, default: null },
        site_type: { type: String, default: 'General' },
        verification_required: { type: [String], default: null },

        status: { type: String, enum: citationStatusArr, default: citationStatus.saved },
        citation_type: { type: String, enum: citationTypesArr, default: citationTypes.add },
        mode: { type: String, enum: citationModesArr, default: citationModes.manual },
        is_harmfull: { type: Boolean, default: false },
        is_existing: { type: Boolean, default: false },

        action_required: { type: Boolean, default: false },
        error_message: { type: String, default: null },
        reject_message: { type: String, default: null },
        action_message: { type: String, default: null },


        submitted_at: { type: Date },
        verified_at: { type: Date },

        is_active: { type: Boolean, default: true },
        created_at: { type: Date, default: Date.now },
        created_by: { type: Schema.Types.ObjectId, default: null },
        updated_at: { type: Date, default: Date.now },
        updated_by: { type: Schema.Types.ObjectId, default: null },
        deleted_at: { type: Date, default: null },
        deleted_by: { type: Schema.Types.ObjectId, default: null },
    },
    {
        collection: 'citations',
    }
);

citationSchema.plugin(globalQueryFilters);
citationSchema.plugin(toJSON);
citationSchema.plugin(addTimestamps);

export const Citation: Model<ICitation> = mongoose.model<ICitation>(
    'Citation',
    citationSchema
);
