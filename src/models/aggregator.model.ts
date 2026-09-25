import mongoose, { Document, Model, Schema } from 'mongoose';
import { currencyTypes, currencyTypesArr } from '../configs/constantTypes';

export interface IAggregator extends Document {
    _id: mongoose.Types.ObjectId;
    name: string;
    price: number;
    currency: string;
    credit: number;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
}

const aggregatorSchema = new Schema<IAggregator>({
    name: { type: String, required: true, trim: true },
    price: { type: Number, required: true, default: 0 },
    currency: { type: String, default: currencyTypes.USD, enum: currencyTypesArr },
    credit: { type: Number, required: true, default: 0 },
    is_active: { type: Boolean, default: true },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
},
    {
        collection: 'aggregators',
    }
);

export const Aggregator: Model<IAggregator> = mongoose.model('Aggregator', aggregatorSchema);

let data = [
    {
        name: 'Foursquare',
        price: 25,
        currency: 'USD',
        credit: 13,
    },
    {
        name: 'Data Axle',
        price: 25,
        currency: 'USD',
        credit: 13,
    },
    {
        name: 'Neustar',
        price: 25,
        currency: 'USD',
        credit: 13,
    },
    {
        name: 'YP Network',
        price: 25,
        currency: 'USD',
        credit: 13,
    },
    {
        name: 'GPS Network',
        price: 25,
        currency: 'USD',
        credit: 13,
    },
]

// data.map(async elm => {
//     let obj = {
//         "name": elm.name,
//         "price": elm.price,
//         "currency": elm.currency,
//         "credit": elm.credit,
//     }
//     await Aggregator.create(obj)
// })