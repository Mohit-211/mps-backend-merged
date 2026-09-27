import httpStatus from 'http-status';
import { verifyPaypalWebhook } from '../../services/common/paypalWebhook';
import { LIMITS, hit } from '../../services/auth/rateLimit';
import { catchAsync, pick, responseWrapper } from '../../utils';
import { subscriptionService } from '../../services';

export const createPlan = catchAsync(async (req, res) => {
	const data = await subscriptionService.createPlan(req.body);

	return responseWrapper(
		res,
		data,
		'Plan created successfully.',
		httpStatus.CREATED,
	);
});

export const getAllPlans = catchAsync(async (req, res) => {
	const data = await subscriptionService.getAllPlans();

	return responseWrapper(
		res,
		data,
		'Completed Successfully.',
		httpStatus.OK,
	);
});

export const getPlansByCountry = catchAsync(async (req, res) => {

	const data =
		await subscriptionService.getPlansByCountry(req.params.country);

	return responseWrapper(
		res,
		data,
		'Completed Successfully.',
		httpStatus.OK,
	);
});

export const updatePlan = catchAsync(async (req, res) => {
	const data = await subscriptionService.updatePlan(
		req.params.plan_id,
		req.body,
	);

	return responseWrapper(
		res,
		data,
		'Plan updated successfully.',
		httpStatus.OK,
	);
});


export const deletePlan = catchAsync(async (req, res) => {
	const data = await subscriptionService.deletePlan(
		req.params.plan_id,
	);

	return responseWrapper(
		res,
		data,
		'Plan deleted successfully.',
		httpStatus.OK,
	);
});


export const generateCoupon = catchAsync(async (req, res) => {
  const body = pick(req.body, ["amount"]);

  const result = await subscriptionService.generateCoupon(body);

  return responseWrapper(
    res,
    result,
    "Coupon generated successfully.",
    httpStatus.CREATED,
  );
});

export const validateCoupon = catchAsync(async (req, res) => {
	const body = pick(req.body, [
		'coupon_code',
		'plan_id',
	]);

	const result = await subscriptionService.validateCoupon(body);

	return responseWrapper(
		res,
		result,
		'Coupon validated successfully.',
		httpStatus.OK,
	);
});

export const getAllCoupons = catchAsync(async (req, res) => {
	const body = pick(req.body, [
		'coupon_code',
		'plan_id',
	]);

	const result = await subscriptionService.getAllCoupons(req.query);

	return responseWrapper(
		res,
		result,
		'Coupon fetched successfully.',
		httpStatus.OK,
	);
});


export const createSubscription = catchAsync(async (req, res) => {
	// Phase 10: the guest checkout stays public but is rate-limited per IP (its logic is Phase 13).
	await hit(LIMITS.checkoutPerIp, [req.ip ?? 'unknown']);
	const data = await subscriptionService.createSubscription(
		req.body,
	);

	return responseWrapper(
		res,
		data,
		"Subscription created successfully.",
		httpStatus.OK,
	);
});

export const paypalWebhook = catchAsync(async (req, res) => {
	// Phase 10 (AUDIT S4): PayPal must confirm the signature before anything is processed.
	if (!(await verifyPaypalWebhook(req.headers, req.body))) {
		return responseWrapper(res, { reason: 'invalid_signature' }, 'Webhook signature could not be verified.', httpStatus.BAD_REQUEST);
	}
	await subscriptionService.paypalWebhook(req.body);

	return responseWrapper(
		res,
		null,
		"Webhook processed.",
		httpStatus.OK
	);
});

export const getPaymentStatus = catchAsync(async (req, res) => {
	await hit(LIMITS.checkoutPerIp, [req.ip ?? 'unknown']);
	if (typeof req.query.subscription_id !== 'string') {
		return responseWrapper(res, '', 'Subscription ID is required.', httpStatus.BAD_REQUEST);
	}
	const data = await subscriptionService.getPaymentStatus(
		req.query.subscription_id as string,
	);

	return responseWrapper(
		res,
		data,
		'Payment status fetched successfully.',
		httpStatus.OK,
	);
});

export const getAllPaymentHistory = catchAsync(
	async (req, res) => {
		const result =
			await subscriptionService.getAllPaymentHistory(req.query);

		return responseWrapper(res, result);
	},
);


export const sendSubscriptionWelcomeMailController = catchAsync(
  async (req, res) => {
    const body = pick(req.body, [
      'email',
      'name',
    ]);

    await subscriptionService.sendSubscriptionWelcomeMailService(
      body.email,
      body.name,
    );

    return responseWrapper(
      res,
      null,
      'Subscription welcome email sent successfully.',
      httpStatus.OK,
    );
  },
);

