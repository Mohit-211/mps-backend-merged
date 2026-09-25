import mongoose, { Document, Model, Schema } from 'mongoose';
import { currencyTypes, currencyTypesArr } from '../configs/constantTypes';

export interface IPaymentCreditPlan extends Document {
    _id: mongoose.Types.ObjectId;
    name?: string;
    description?: string;
    price?: number;
    currency?: string;
    credit?: number;
    discount?: number;
    final_price?: number;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
}

const paymentCreditPlanSchema = new Schema<IPaymentCreditPlan>({
    name: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    price: { type: Number, required: true, default: 0 },
    currency: { type: String, default: currencyTypes.USD, enum: currencyTypesArr },
    credit: { type: Number, required: true, default: 0 },
    discount: { type: Number, required: true, default: 0 },
    final_price: { type: Number, required: true, default: 0 },
    is_active: { type: Boolean, default: true },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
},
    {
        collection: 'paymentCreditPlans',
    }
);

export const PaymentCreditPlan: Model<IPaymentCreditPlan> = mongoose.model('PaymentCreditPlan', paymentCreditPlanSchema);

let data = [
    {
        name: 'Start',
        description: 'Citation builder submission',
        price: 1000,
        currency: 'USD',
        credit: 500,
        discount: 0,
        final_price: 1000
    },
    {
        name: 'Intermediate',
        description: 'Citation builder submission',
        price: 2000,
        currency: 'USD',
        credit: 1000,
        discount: 0,
        final_price: 2000
    },
    {
        name: 'Advanced',
        description: 'Citation builder submission',
        price: 4000,
        currency: 'USD',
        credit: 2000,
        discount: 0,
        final_price: 4000
    },
]

// data.map(async elm => {
//     let obj = {
//         "name": elm.name,
//         "description": elm.description,
//         "price": elm.price,
//         "currency": elm.currency,
//         "credit": elm.credit,
//         "discount": elm.discount,
//         "final_price": elm.final_price,
//     }
//     await PaymentCreditPlan.create(obj)
// })