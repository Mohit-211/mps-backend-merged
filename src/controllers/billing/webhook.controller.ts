import httpStatus from 'http-status';
import { paymentProvider } from '../../services/billing/providers';
import { webhookHandler } from '../../services/billing/webhook';
import { catchAsync, responseWrapper } from '../../utils';

// POST /api/v1/subscription/paypal/webhook (Phase 10 verification, Phase 13a handlers, 13b provider
// interface). A handler error answers 500 so the provider retries; duplicates and unknown events answer 200.
export const paypalWebhook = catchAsync(async (req, res) => {
	const provider = paymentProvider();
	if (!(await provider.verifyWebhook(req.headers, req.body))) {
		return responseWrapper(res, { reason: 'invalid_signature' }, 'Webhook signature could not be verified.', httpStatus.BAD_REQUEST);
	}
	const parsed = provider.parseWebhook(req.body);
	if (!parsed) return responseWrapper(res, { handled: false, note: 'malformed event' }, 'Webhook ignored.', httpStatus.OK);
	return responseWrapper(res, await webhookHandler.handle(parsed), 'Webhook processed.', httpStatus.OK);
});
