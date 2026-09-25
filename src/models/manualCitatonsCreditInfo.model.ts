import mongoose, { Document, Model, Schema } from 'mongoose';
import { currencyTypes, currencyTypesArr } from '../configs/constantTypes';

export interface IManualCiationCreditInfo extends Document {
    _id: mongoose.Types.ObjectId;
    no_of_citations: number;
    price: number;
    currency: string;
    credit: number;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
}

const manualCiationCreditInfoSchema = new Schema<IManualCiationCreditInfo>({
    no_of_citations: { type: Number, required: true, default: 5 },
    price: { type: Number, required: true, default: 0 },
    currency: { type: String, default: currencyTypes.USD, enum: currencyTypesArr },
    credit: { type: Number, required: true, default: 0 },
    is_active: { type: Boolean, default: true },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
},
    {
        collection: 'manualCiationCreditInfo',
    }
);

export const ManualCiationCreditInfo: Model<IManualCiationCreditInfo> = mongoose.model('ManualCiationCreditInfo', manualCiationCreditInfoSchema);

let data = [
    {
        no_of_citations: 5,
        price: 21,
        currency: 'USD',
        credit: 5,
    },
    {
        no_of_citations: 10,
        price: 35,
        currency: 'USD',
        credit: 10,
    },
    {
        no_of_citations: 15,
        price: 49,
        currency: 'USD',
        credit: 15,
    },
    {
        no_of_citations: 20,
        price: 63,
        currency: 'USD',
        credit: 20,
    },
    {
        no_of_citations: 30,
        price: 95,
        currency: 'USD',
        credit: 30,
    },
]

// data.map(async elm => {
//     let obj = {
//         "no_of_citations": elm.no_of_citations,
//         "price": elm.price,
//         "currency": elm.currency,
//         "credit": elm.credit,
//     }
//     await ManualCiationCreditInfo.create(obj)
// })