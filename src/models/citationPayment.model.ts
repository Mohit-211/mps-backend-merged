import mongoose, { Document, Model, Schema } from 'mongoose';
import { addTimestamps, globalQueryFilters, toJSON } from '../configs/mongoPlugins';
import { citationOrderStatus, citationOrderStatusArr } from '../configs/constantTypes';

export interface ILocationCitation extends Document {
    _id: mongoose.Types.ObjectId;
    location_id: Schema.Types.ObjectId;
    campaign_id: Schema.Types.ObjectId;
    user_id?: Schema.Types.ObjectId;
    citation_payment_id?: Schema.Types.ObjectId;
    orderStatus: string;

    action_required: boolean;
    error_message?: string;
    reject_message?: string;
    action_message?: string;
    price?: number;
    currancy?: string;
    credit: number;

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

const locationCitationSchema = new Schema<ILocationCitation>(
    {
        location_id: { type: Schema.Types.ObjectId, required: true },
        campaign_id: { type: Schema.Types.ObjectId, required: true },
        user_id: { type: Schema.Types.ObjectId, required: true },
        citation_payment_id: { type: Schema.Types.ObjectId, required: false, default: null },
        orderStatus: { type: String, enum: citationOrderStatusArr, default: citationOrderStatus.saved },

        action_required: { type: Boolean, default: false },
        error_message: { type: String, default: null },
        reject_message: { type: String, default: null },
        action_message: { type: String, default: null },
        price: { type: Number, required: true, default: 0 },
        currancy: { type: String, required: true, trim: true, default: 'USD' },
        credit: { type: Number, required: true, default: 0 },

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
