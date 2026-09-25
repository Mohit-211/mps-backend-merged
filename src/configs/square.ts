import config from "./config";
import { SquareClient, SquareEnvironment } from 'square'
import crypto from 'crypto'


export const squareClient = new SquareClient({
    environment: SquareEnvironment.Sandbox,
    token: config.square.squareAccessToken
});

export const createCustomer = async (email: string, customer_id = '') => {
    try {
        let customer = null;
        try {
            if (customer_id) {
                const getResult = await squareClient.customers.get({
                    customerId: customer_id,
                });
                customer = getResult.customer;
                if (customer && customer.id) {
                    return customer.id;
                }
            }
        } catch (getError) {
            return false
        }

        const createResult = await squareClient.customers.create({
            idempotencyKey: crypto.randomUUID(),
            emailAddress: email,
        });

        customer = createResult.customer;

        if (customer && customer.id) {
            return customer.id;
        }

        return false;
    } catch (err) {
        return false;
    }
};

