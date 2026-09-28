import { IncomingHttpHeaders } from 'http';
import config from '../../configs/config';
import logger from '../../configs/logger';
import { paypalClient } from '../../clients/paypalClient';

// Phase 10 (AUDIT S4): a PayPal webhook is processed only after PayPal confirms it
// (POST /v1/notifications/verify-webhook-signature with the transmission headers and PAYPAL_WEBHOOK_ID).
// Without PAYPAL_WEBHOOK_ID (development) every webhook is refused.

export interface PaypalVerifyDeps {
	webhookId?: string;
	/** Returns PayPal's verification_status for the request body. */
	verify?: (body: Record<string, unknown>) => Promise<string>;
}

const defaultVerify = (body: Record<string, unknown>): Promise<string> => paypalClient().verifyWebhookSignature(body);

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
