import express from 'express';
import request from 'supertest';
import { findUnsafeKey } from '../../src/middlewares/common/sanitizeRequest';
import { verifyPaypalWebhook } from '../../src/services/common/paypalWebhook';

// Phase 10 (AUDIT S6, S4): operator keys are refused; PayPal webhooks must be verified by PayPal.

jest.mock('../../src/configs/mongoConnection', () => ({ agenda: {} }));
jest.mock('node-cron', () => ({ schedule: jest.fn() }));

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const app: express.Express = require('../../src/app').default;
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

describe('request sanitiser (S6)', () => {
	it('finds $ and dotted keys at any depth, and leaves ordinary values alone', () => {
		expect(findUnsafeKey({ email: { $gt: '' } }, 'body')).toBe('body.email.$gt');
		expect(findUnsafeKey({ a: [{ b: { 'x.y': 1 } }] }, 'body')).toBe('body.a.0.b.x.y');
		expect(findUnsafeKey({ email: 'a@b.c', note: '$5 off. Thanks.', list: ['$x'] }, 'body')).toBeNull();
	});

	it('the app answers 400 invalid_input for operator objects in the body and the query', async () => {
		const body = await request(app).post('/api/v1/user/auth/verify-otp').send({ email: { $ne: null }, otp: '123456' });
		expect(body.status).toBe(400);
		expect(body.body.data).toMatchObject({ reason: 'invalid_input', field: 'body.email.$ne' });
		const query = await request(app).get('/api/v1/subscription/payment-status?subscription_id[$ne]=x');
		expect(query.status).toBe(400);
		expect(query.body.data).toMatchObject({ reason: 'invalid_input' });
	});
});

describe('PayPal webhook (S4)', () => {
	const headers = {
		'paypal-auth-algo': 'SHA256withRSA',
		'paypal-cert-url': 'https://api.paypal.com/cert.pem',
		'paypal-transmission-id': 'id-1',
		'paypal-transmission-sig': 'sig',
		'paypal-transmission-time': '2026-09-27T10:00:00Z',
	};
	const event = { id: 'WH-EVT-1', event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', resource: { id: 'I-ABC' } };

	it('is verified with PayPal: SUCCESS only; missing headers, no webhook id, a FAILURE or an error all refuse', async () => {
		const verify = jest.fn(async () => 'SUCCESS');
		expect(await verifyPaypalWebhook(headers, event, { webhookId: 'WH-1', verify })).toBe(true);
		expect(verify).toHaveBeenCalledWith(expect.objectContaining({ webhook_id: 'WH-1', transmission_id: 'id-1', webhook_event: event }));
		expect(await verifyPaypalWebhook(headers, event, { webhookId: 'WH-1', verify: async () => 'FAILURE' })).toBe(false);
		expect(await verifyPaypalWebhook(headers, event, { webhookId: 'WH-1', verify: async () => Promise.reject(new Error('down')) })).toBe(false);
		expect(await verifyPaypalWebhook({ ...headers, 'paypal-transmission-sig': undefined }, event, { webhookId: 'WH-1', verify })).toBe(false);
		expect(await verifyPaypalWebhook(headers, event, { webhookId: '', verify })).toBe(false);
	});

	it('an unsigned webhook to the app is refused before anything is processed', async () => {
		const res = await request(app).post('/api/v1/subscription/paypal/webhook').send(event);
		expect(res.status).toBe(400);
		expect(res.body.data).toMatchObject({ reason: 'invalid_signature' });
	});
});
