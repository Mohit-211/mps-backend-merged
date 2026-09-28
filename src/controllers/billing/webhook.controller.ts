import httpStatus from 'http-status';
import { verifyPaypalWebhook } from '../../services/common/paypalWebhook';
import { webhookHandler } from '../../services/billing/webhook';
import { catchAsync, responseWrapper } from '../../utils';

// POST /api/v1/subscription/paypal/webhook (Phase 10 verification, Phase 13a handlers). A handler
// error answers 500 so PayPal retries; duplicates and unknown events answer 200.
export const paypalWebhook = catchAsync(async (req, res) => {
	if (!(await verifyPaypalWebhook(req.headers, req.body))) {
		return responseWrapper(res, { reason: 'invalid_signature' }, 'Webhook signature could not be verified.', httpStatus.BAD_REQUEST);
	}
	const result = await webhookHandler.handle(req.body);
	return responseWrapper(res, result, 'Webhook processed.', httpStatus.OK);
});
