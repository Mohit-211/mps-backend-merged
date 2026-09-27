import axios from 'axios';
import { IncomingHttpHeaders } from 'http';
import config from '../../configs/config';
import logger from '../../configs/logger';
import { BASE_URL } from '../../configs/paypal';

// Phase 10 (AUDIT S4): a PayPal webhook is processed only after PayPal confirms it
// (POST /v1/notifications/verify-webhook-signature with the transmission headers and PAYPAL_WEBHOOK_ID).
// Without PAYPAL_WEBHOOK_ID (development) every webhook is refused.

export interface PaypalVerifyDeps {
	webhookId?: string;
	/** Returns PayPal's verification_status for the request body. */
	verify?: (body: Record<string, unknown>) => Promise<string>;
}

const accessToken = async (): Promise<string> => {
	const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID ?? ''}:${process.env.PAYPAL_CLIENT_SECRET ?? ''}`).toString('base64');
	const { data } = await axios.post(`${BASE_URL}/v1/oauth2/token`, 'grant_type=client_credentials', {
		headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
		timeout: 15000,
	});
	return (data as { access_token: string }).access_token;
};

const defaultVerify = async (body: Record<string, unknown>): Promise<string> => {
	const token = await accessToken();
	const { data } = await axios.post(`${BASE_URL}/v1/notifications/verify-webhook-signature`, body, {
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
		timeout: 15000,
	});
	return String((data as { verification_status?: string }).verification_status ?? '');
};

const header = (headers: IncomingHttpHeaders, name: string): string | null => {
	const v = headers[name];
	return typeof v === 'string' && v.length > 0 ? v : null;
};

/** true only when PayPal answers SUCCESS for this event and these headers. Never throws. */
export const verifyPaypalWebhook = async (headers: IncomingHttpHeaders, event: unknown, deps: PaypalVerifyDeps = {}): Promise<boolean> => {
	const webhookId = deps.webhookId ?? config.paypal.webhookId;
	if (!webhookId) {
		logger.warn('paypal webhook refused: PAYPAL_WEBHOOK_ID is not set');
		return false;
	}
	const fields = {
		auth_algo: header(headers, 'paypal-auth-algo'),
		cert_url: header(headers, 'paypal-cert-url'),
		transmission_id: header(headers, 'paypal-transmission-id'),
		transmission_sig: header(headers, 'paypal-transmission-sig'),
		transmission_time: header(headers, 'paypal-transmission-time'),
	};
	if (Object.values(fields).some((v) => v === null) || !event || typeof event !== 'object') return false;
	try {
		const status = await (deps.verify ?? defaultVerify)({ ...fields, webhook_id: webhookId, webhook_event: event });
		return status === 'SUCCESS';
	} catch (err) {
		logger.warn(`paypal webhook verification call failed: ${(err as Error).message}`);
		return false;
	}
};
