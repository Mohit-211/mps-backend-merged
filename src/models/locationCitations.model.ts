import mongoose, { Document, Model, Schema } from 'mongoose';
import { addTimestamps, globalQueryFilters, toJSON } from '../configs/mongoPlugins';
import { citationCampaignStatus, citationCampaignStatusArr, citationOrderStatus, citationOrderStatusArr, currencyTypes, currencyTypesArr, paymentStatusTypes, paymentStatusTypesArr } from '../configs/constantTypes';

export interface ILocationCitation extends Document {
    _id: mongoose.Types.ObjectId;
    location_id: Schema.Types.ObjectId;
    campaign_id: Schema.Types.ObjectId;
    user_id?: Schema.Types.ObjectId;
    citation_payment_id?: Schema.Types.ObjectId;

    orderStatus: string;
    campaignStatus: string;
    paymentStatus: string;

    action_required: boolean;
    error_message?: string;
    reject_message?: string;
    action_message?: string;
    price?: number;
    currency?: string;
    credit: number;

    manual_citation_count: number;
    aggregators_count: number;
    nap_updated_count: number;
    nap_addition_count: number;

    submitted_at?: Date;
    verified_at?: Date;
    is_term_accepted: boolean;
    is_active: boolean;
    created_at: Date;
    created_by?: Schema.Types.ObjectId;
    updated_at: Date;
    updated_by?: Schema.Types.ObjectId;
    deleted_at?: Date;
    deleted_by?: Schema.Types.ObjectId;
}

const locationCitationSchema = new Schema<ILocationCitation>(
    {
        location_id: { type: Schema.Types.ObjectId, required: true },
        campaign_id: { type: Schema.Types.ObjectId, required: true, ref: 'Campaign' },

        user_id: { type: Schema.Types.ObjectId, required: true },
        citation_payment_id: { type: Schema.Types.ObjectId, required: false, default: null },

        orderStatus: { type: String, enum: citationOrderStatusArr, default: citationOrderStatus.saved },
        campaignStatus: { type: String, enum: citationCampaignStatusArr, default: citationCampaignStatus.saved },
        paymentStatus: { type: String, enum: paymentStatusTypesArr, default: paymentStatusTypes.PENDING },

        action_required: { type: Boolean, default: false },
        error_message: { type: String, default: null },
        reject_message: { type: String, default: null },
        action_message: { type: String, default: null },
        price: { type: Number, required: true, default: 0 },
        currency: { type: String, default: currencyTypes.USD, enum: currencyTypesArr },
        credit: { type: Number, required: true, default: 0 },

        manual_citation_count: { type: Number, required: true, default: 0 },
        aggregators_count: { type: Number, required: true, default: 0 },
        nap_updated_count: { type: Number, required: true, default: 0 },
        nap_addition_count: { type: Number, required: true, default: 0 },

        
        submitted_at: { type: Date },
        verified_at: { type: Date },
        is_term_accepted: { type: Boolean, default: true },
        is_active: { type: Boolean, default: true },
        created_at: { type: Date, default: Date.now },
        created_by: { type: Schema.Types.ObjectId, default: null },
        updated_at: { type: Date, default: Date.now },
        updated_by: { type: Schema.Types.ObjectId, default: null },
        deleted_at: { type: Date, default: null },
        deleted_by: { type: Schema.Types.ObjectId, default: null },
    },
    {
        collection: 'locationCitations',
    }
);

locationCitationSchema.plugin(globalQueryFilters);
locationCitationSchema.plugin(toJSON);
locationCitationSchema.plugin(addTimestamps);

export const LocationCitation: Model<ILocationCitation> = mongoose.model<ILocationCitation>(
    'LocationCitation',
    locationCitationSchema
);
