import mongoose, { Document, Model, Schema } from 'mongoose';
import { currencyTypes, currencyTypesArr } from '../configs/constantTypes';

export interface ICitationDuplicateRemoveCredit extends Document {
    _id: mongoose.Types.ObjectId;
    price: number;
    currency: string;
    credit: number;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
}

const citationDuplicateRemoveCreditSchema = new Schema<ICitationDuplicateRemoveCredit>({
    price: { type: Number, required: true, default: 0 },
    currency: { type: String, default: currencyTypes.USD, enum: currencyTypesArr },
    credit: { type: Number, required: true, default: 0 },
    is_active: { type: Boolean, default: true },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
},
    {
        collection: 'citationDuplicateRemoveCredit',
    }
);

export const CitationDuplicateRemoveCredit: Model<ICitationDuplicateRemoveCredit> = mongoose.model('CitationDuplicateRemoveCredit', citationDuplicateRemoveCreditSchema);

let data = [
    {
        price: 28,
        currency: 'USD',
        credit: 8,
    },
]

// data.map(async elm => {
//     let obj = {
//         "price": elm.price,
//         "currency": elm.currency,
//         "credit": elm.credit,
//     }
//     await CitationDuplicateRemoveCredit.create(obj)
// })