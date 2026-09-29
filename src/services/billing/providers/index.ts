import { createPaypalProvider } from './paypal';
import { PaymentProvider } from './types';

// The payment provider in use (Phase 13b): PayPal. Billing code gets it through here only.

let current: PaymentProvider | null = null;
export const paymentProvider = (): PaymentProvider => (current ??= createPaypalProvider());

export * from './types';
