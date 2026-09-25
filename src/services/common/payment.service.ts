import httpStatus from 'http-status';
import crypto from 'crypto'

import { Profile, CreditPayment, User, PaymentCreditPlan } from '../../models';
import { ApiError } from '../../utils';
import { currencyTypes, paymentGateways, paymentStatusTypes, citationOrderStatus } from '../../configs/constantTypes';
import { BodyDefinition } from '../../types/RouteDefinition';
import { createCustomer, squareClient } from '../../configs/square';
import config from '../../configs/config';
import axios from 'axios';

export const makeSquarePayment = async (body: BodyDefinition): Promise<any> => {
    try {
        const { user, token, citation_location_id, locationCitationDoc, planDoc } = body;
        const { credit, final_price: amount } = planDoc;
        const userDoc = await User.findById(user._id)

        const customer_id = await createCustomer(user.email, userDoc?.square_customer_id || '');
        if (!customer_id) {
            throw new ApiError(httpStatus.BAD_REQUEST, "No payment customer found");
        }

        const price = Math.round(amount);
        const idempotencyKey = crypto.randomUUID();

        const requestBody = {
            idempotency_key: idempotencyKey,
            amount_money: {
                amount: price,
                currency: planDoc.currency,
            },
            source_id: token,
            customer_id: customer_id,
            location_id: config.square.squareLocationId,
        };

        const response = await axios.post(
            'https://connect.squareupsandbox.com/v2/payments',
            requestBody,
            {
                headers: {
                    'Square-Version': '2025-08-20',
                    'Authorization': `Bearer ${config.square.squareAccessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const result = response.data;
        if (!result || !result.payment) {
            throw new ApiError(httpStatus.BAD_REQUEST, "Invalid payment token provided");
        }

        if (result.payment.status === "COMPLETED") {
            const payment = result.payment;
            const paymentObj = {
                user_id: user._id,
                transactionId: payment.id,
                intentId: payment.id,
                price: amount,
                credit: credit,
                currency: planDoc.currency,
                paymentGateway: paymentGateways.square,
                mode: payment.sourceType,
                status: paymentStatusTypes.SUCCESS,
                verified_at: payment.created_at,
                gateway_response: payment,
            };

            const paymentDoc = await CreditPayment.create(paymentObj);
            if (!paymentDoc) {
                throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, "Internal Server Error");
            }

            let credit_spent = 0;
            if (citation_location_id && locationCitationDoc) {
                locationCitationDoc.paymentStatus = paymentStatusTypes.SUCCESS;
                locationCitationDoc.citation_payment_id = paymentDoc._id;
                locationCitationDoc.orderStatus = citationOrderStatus.confirmed;
                credit_spent = locationCitationDoc.credit;
                await locationCitationDoc.save();
            }

            userDoc.available_credit = userDoc.available_credit + (credit - credit_spent);
            userDoc.square_customer_id = customer_id;
            await userDoc.save();

        } else {
            throw new ApiError(httpStatus.BAD_REQUEST, "Payment not completed.");
        }

        return locationCitationDoc;

    } catch (error: any) {
        console.error("Payment error: ", error.response ? error.response.data : error.message);
        throw new ApiError(
            error.response?.status || error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
            error.response?.data?.message || error.message
        );
    }
};

export const getPlans = async (body: BodyDefinition): Promise<any> => {
    try {
        const paymentPlansDoc = await PaymentCreditPlan.find()
        if (!paymentPlansDoc) {
            throw new ApiError(
                httpStatus.BAD_REQUEST,
                "Failed to find all plans"
            );
        }
        return paymentPlansDoc;
    } catch (error) {
        throw new ApiError(
            error.statusCode
                ? error.statusCode
                : httpStatus.INTERNAL_SERVER_ERROR,
            error.message,
        );
    }
};

export const getAllPayments = async (): Promise<any> => {
    try {
        const paymentPlansDoc = await CreditPayment.find()
        if (!paymentPlansDoc) {
            throw new ApiError(
                httpStatus.BAD_REQUEST,
                "Failed to find all plans"
            );
        }
        return paymentPlansDoc;
    } catch (error) {
        throw new ApiError(
            error.statusCode
                ? error.statusCode
                : httpStatus.INTERNAL_SERVER_ERROR,
            error.message,
        );
    }
};