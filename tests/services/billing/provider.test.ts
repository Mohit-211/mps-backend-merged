import fs from 'fs';
import path from 'path';
import { createPaypalProvider, parsePaypalEvent } from '../../../src/services/billing/providers/paypal';
import { OrderNotApprovedError } from '../../../src/services/billing/providers/types';

// Phase 13b: the payment-provider interface. PayPal specifics stay in providers/paypal.ts.

describe('billing code talks to payments only through the provider', () => {
	it('no billing file outside providers/ imports the PayPal client', () => {
		const dir = path.resolve(__dirname, '../../../src/services/billing');
		const offenders: string[] = [];
		const walk = (d: string) => {
			for (const f of fs.readdirSync(d)) {
				const p = path.join(d, f);
				if (fs.statSync(p).isDirectory()) {
					if (f !== 'providers') walk(p);
				} else if (/clients\/paypalClient/.test(fs.readFileSync(p, 'utf8'))) offenders.push(path.relative(dir, p));
			}
		};
		walk(dir);
		const controllers = path.resolve(__dirname, '../../../src/controllers');
		for (const f of ['billing/billing.controller.ts', 'billing/webhook.controller.ts', 'admin/billing.controller.ts']) {
			if (/clients\/paypalClient/.test(fs.readFileSync(path.join(controllers, f), 'utf8'))) offenders.push(f);
		}
		expect(offenders).toEqual([]);
	});
});

describe('PayPal provider', () => {
	it('maps PayPal events to billing events', () => {
		expect(parsePaypalEvent('BILLING.SUBSCRIPTION.ACTIVATED', { id: 'I-1', status: 'ACTIVE', custom_id: 'abc', billing_info: { next_billing_time: '2026-11-01T00:00:00Z', failed_payments_count: 0 } })).toEqual({
			kind: 'subscription_updated',
			subscription: { id: 'I-1', state: 'active', customId: 'abc', startTime: null, nextBillingTime: new Date('2026-11-01T00:00:00Z'), failedPayments: 0 },
		});
		expect(parsePaypalEvent('BILLING.SUBSCRIPTION.SUSPENDED', { id: 'I-1', status: 'SUSPENDED' })).toMatchObject({ subscription: { state: 'suspended' } });
		expect(parsePaypalEvent('PAYMENT.SALE.COMPLETED', { id: 'S-1', amount: { total: '68.00', currency: 'CAD' }, billing_agreement_id: 'I-1', create_time: '2026-10-01T00:00:00Z' })).toEqual({
			kind: 'subscription_payment',
			providerSubscriptionId: 'I-1',
			customId: null,
			paymentId: 'S-1',
			amount: 68,
			currency: 'CAD',
			paidAt: new Date('2026-10-01T00:00:00Z'),
		});
		expect(parsePaypalEvent('PAYMENT.SALE.DENIED', { billing_agreement_id: 'I-1' })).toMatchObject({ kind: 'subscription_payment_failed', providerSubscriptionId: 'I-1' });
		expect(parsePaypalEvent('PAYMENT.SALE.REVERSED', { id: 'S-2' })).toEqual({ kind: 'payment_refunded', paymentRef: 'S-2', note: 'reversed' });
		expect(parsePaypalEvent('PAYMENT.CAPTURE.REFUNDED', { links: [{ rel: 'up', href: 'https://api.paypal.com/v2/payments/captures/CAP-9' }] })).toEqual({ kind: 'payment_refunded', paymentRef: 'CAP-9', note: 'refunded' });
		expect(parsePaypalEvent('PAYMENT.CAPTURE.COMPLETED', { id: 'CAP-1', amount: { value: '10.00' }, supplementary_data: { related_ids: { order_id: 'O-1' } } })).toEqual({ kind: 'order_captured', providerOrderId: 'O-1', captureId: 'CAP-1', amount: 10 });
		expect(parsePaypalEvent('CHECKOUT.ORDER.APPROVED', { id: 'O-1' })).toEqual({ kind: 'order_approved', providerOrderId: 'O-1' });
		expect(parsePaypalEvent('SOMETHING.ELSE', {})).toEqual({ kind: 'ignored' });
	});

	it('captures an order: already captured is read back; not approved is a typed error', async () => {
		const order = { id: 'O-1', status: 'COMPLETED', custom_id: 'x', approve_url: null, capture: { id: 'CAP-1', status: 'COMPLETED', amount: 10, currency: 'CAD' } };
		const client = {
			captureOrder: jest.fn(async () => {
				throw Object.assign(new Error('x'), { reason: 'ORDER_ALREADY_CAPTURED' });
			}),
			getOrder: jest.fn(async () => order),
		};
		const provider = createPaypalProvider({ client: () => client as never });
		expect(await provider.captureOrder('O-1', 'ours')).toEqual({ id: 'O-1', approveUrl: null, capture: { id: 'CAP-1', state: 'completed', amount: 10, currency: 'CAD' } });
		expect(client.captureOrder).toHaveBeenCalledWith('O-1', 'capture-ours');
		client.captureOrder.mockImplementationOnce(async () => {
			throw Object.assign(new Error('x'), { reason: 'ORDER_NOT_APPROVED' });
		});
		await expect(provider.captureOrder('O-1', 'ours')).rejects.toBeInstanceOf(OrderNotApprovedError);
	});

	it('checkout needs credentials and a plan for the currency; the renewal lead time is a provider setting', () => {
		const configured = createPaypalProvider({ client: () => ({ configured: () => true }) as never, planIds: { USD: 'P-USD' }, renewalLeadDays: 12 });
		expect(configured.canSubscribe('USD')).toBe(true);
		expect(configured.canSubscribe('CAD')).toBe(false);
		expect(configured.renewalLeadDays).toBe(12);
		expect(createPaypalProvider({ client: () => ({ configured: () => false }) as never, planIds: { USD: 'P-USD' } }).canSubscribe('USD')).toBe(false);
	});
});
