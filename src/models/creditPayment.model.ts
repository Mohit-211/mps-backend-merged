import mongoose, { Document, Model, Schema } from 'mongoose';
import { addTimestamps, globalQueryFilters, toJSON } from '../configs/mongoPlugins';
import { currencyTypes, currencyTypesArr, paymentGateways, paymentGatewaysArr, paymentModeTypes, paymentModeTypesArr, paymentResources, paymentResourcesArr, paymentStatusTypes, paymentStatusTypesArr, paymentTypes, paymentTypesArr, taxTypes, taxTypesArr } from '../configs/constantTypes';

export interface ICreditPayment extends Document {
    _id: mongoose.Types.ObjectId;
    user_id: Schema.Types.ObjectId;

    transactionId: string;
    intentId: string;
    resource: string;

    price: number;
    credit: number;
    currency: string;
    discount: number;

    paymentGateway: string;
    mode: string;              // CREDIT_CARD, WALLET, etc.
    type: string;              // ONE_TIME, SUBSCRIPTION

    status: string;            // PENDING, SUCCESS, FAILED, REFUNDED, etc.
    action_required: boolean;
    error_message?: string | null;

    invoiceId: string;
    invoicePdfUrl: string;

    is_refunded: boolean;
    refund_reason: string;
    refund_id: string;
    refund_mode: string;
    refund_amount: number;
    refund_deduction_amount: number;

    tax_applicable: boolean;
    tax_percentage: number;
    tax_amount: number;
    tax_type: string;
    tax_info?: Record<string, any> | null;

    verified_at?: Date;

    gateway_response?: Record<string, any> | null;

    is_active: boolean;
    created_at: Date;
    created_by?: Schema.Types.ObjectId | null;
    updated_at: Date;
    updated_by?: Schema.Types.ObjectId | null;
    deleted_at?: Date | null;
    deleted_by?: Schema.Types.ObjectId | null;
}


const creditPaymentSchema = new Schema<ICreditPayment>(
    {
        user_id: { type: Schema.Types.ObjectId, required: true },
        transactionId: { type: String, default: '' },
        intentId: { type: String, default: '' },
        resource: { type: String, default: paymentResources.creadit, enum: paymentResourcesArr },

        price: { type: Number, default: 0 },
        credit: { type: Number, required: true, default: 0 },
        currency: { type: String, default: currencyTypes.USD, enum: currencyTypesArr },
        discount: { type: Number, default: 0 },

        paymentGateway: { type: String, default: paymentGateways.stripe, enum: paymentGatewaysArr },
        mode: { type: String, enum: paymentModeTypesArr, default: paymentModeTypes.CREDIT_CARD },
        type: { type: String, default: paymentTypes.ONE_TIME, enum: paymentTypesArr },

        status: { type: String, default: paymentStatusTypes.PENDING, enum: paymentStatusTypesArr },
        action_required: { type: Boolean, default: false },
        verified_at: { type: Date },
        error_message: { type: String, default: null },

        invoiceId: { type: String, default: '' },
        invoicePdfUrl: { type: String, default: '' },

        is_refunded: { type: Boolean, default: false },
        refund_reason: { type: String, default: '' },
        refund_id: { type: String, default: '' },
        refund_mode: { type: String, enum: paymentModeTypesArr, default: paymentModeTypes.CREDIT_CARD },
        refund_amount: { type: Number, default: 0 },
        refund_deduction_amount: { type: Number, default: 0 },

        tax_applicable: { type: Boolean, default: false },
        tax_percentage: { type: Number, default: 0 },
        tax_amount: { type: Number, default: 0 },
        tax_type: { type: String, default: taxTypes.none, enum: taxTypesArr },
        tax_info: { type: Object, default: null },

        gateway_response: { type: Object, default: null },

        is_active: { type: Boolean, default: true },
        created_at: { type: Date, default: Date.now },
        created_by: { type: Schema.Types.ObjectId, default: null },
        updated_at: { type: Date, default: Date.now },
        updated_by: { type: Schema.Types.ObjectId, default: null },
        deleted_at: { type: Date, default: null },
        deleted_by: { type: Schema.Types.ObjectId, default: null },
    },
    {
        collection: 'location_credit_payments',
    }
);

creditPaymentSchema.plugin(globalQueryFilters);
creditPaymentSchema.plugin(toJSON);
creditPaymentSchema.plugin(addTimestamps);

/*
creditPaymentSchema.index({ user_id: 1 });
creditPaymentSchema.index({ transactionId: 1 }, { unique: true, sparse: true });
creditPaymentSchema.index({ status: 1 });
*/

export const CreditPayment: Model<ICreditPayment> = mongoose.model<ICreditPayment>(
    'CreditPayment',
    creditPaymentSchema
);