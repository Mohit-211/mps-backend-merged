import axios from 'axios';
import { BASE_URL } from '../../configs/paypal';
import {
	Coupon,
	Payment,
	SubscriptionPlan,
} from '../../models';
import {  sendSubscriptionWelcomeMail } from './email.service';


async function getAccessToken() {
	const auth = Buffer.from(
		`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`,
	).toString("base64");

	console.log("PAYPAL MODE:", process.env.PAYPAL_MODE);
	console.log("BASE URL:", BASE_URL);

	try {
		const { data } = await axios.post(
			`${BASE_URL}/v1/oauth2/token`,
			"grant_type=client_credentials",
			{
				headers: {
					Authorization: `Basic ${auth}`,
					"Content-Type": "application/x-www-form-urlencoded",
				},
			},
		);

		console.log("PayPal Access Token Generated");

		return data.access_token;
	} catch (error: any) {
		console.log("========================================");
		console.log("PAYPAL TOKEN ERROR");
		console.log("Status:", error.response?.status);
		console.log(
			"Response:",
			JSON.stringify(error.response?.data, null, 2),
		);
		console.log("========================================");

		throw error;
	}
}

export async function createPaypalProduct(name: string, description: string) {
	const token = await getAccessToken();

	const { data } = await axios.post(
		`${BASE_URL}/v1/catalogs/products`,
		{
			name,
			description,
			type: 'SERVICE',
			category: 'SOFTWARE',
		},
		{
			headers: { Authorization: `Bearer ${token}` },
		},
	);

	return data;
}

export async function createPaypalBillingPlan(
	productId: string,
	name: string,
	description: string,
	currency: string,
	monthlyPrice: number,
	setupFee: number,
) {
	const token = await getAccessToken();

	const { data } = await axios.post(
		`${BASE_URL}/v1/billing/plans`,
		{
			product_id: productId,
			name,
			description: description || `${name} Monthly Subscription`,
			status: 'ACTIVE',

			billing_cycles: [
				{
					frequency: {
						interval_unit: 'MONTH',
						interval_count: 1,
					},
					tenure_type: 'REGULAR',
					sequence: 1,
					total_cycles: 0,
					pricing_scheme: {
						fixed_price: {
							value: monthlyPrice.toFixed(2),
							currency_code: currency,
						},
					},
				},
			],

			payment_preferences: {
				auto_bill_outstanding: true,
				setup_fee: {
					value: setupFee.toFixed(2),
					currency_code: currency,
				},
				setup_fee_failure_action: 'CONTINUE',
				payment_failure_threshold: 3,
			},
		},
		{
			headers: { Authorization: `Bearer ${token}` },
		},
	);

	return data;
}

export async function createPaypalSubscription(
	paypalPlanId: string,
	discountedSetupFee?: number,
	currency: string = "USD",
) {
	const token = await getAccessToken();

	const requestBody: any = {
		plan_id: paypalPlanId,

		application_context: {
			brand_name: "MyPageSEO",
			locale: "en-US",
			shipping_preference: "NO_SHIPPING",
			user_action: "SUBSCRIBE_NOW",

			return_url: `${process.env.FRONTEND_URL}/payment/success`,
			cancel_url: `${process.env.FRONTEND_URL}/payment/cancel`,
		},
	};

	// Override setup fee when coupon is applied
	if (discountedSetupFee !== undefined && discountedSetupFee >= 0) {
		requestBody.plan = {
			payment_preferences: {
				setup_fee: {
					value: discountedSetupFee.toFixed(2),
					currency_code: currency,
				},
				setup_fee_failure_action: "CONTINUE",
				auto_bill_outstanding: true,
			},
		};
	}

	try {
		console.log("========================================");
		console.log("Creating PayPal Subscription...");
		console.log("BASE URL:", BASE_URL);
		console.log("Plan ID:", paypalPlanId);
		console.log("Currency:", currency);
		console.log("Discounted Setup Fee:", discountedSetupFee);
		console.log(
			"Access Token:",
			token ? `${token.substring(0, 20)}...` : null,
		);
		console.log(
			"Request Body:",
			JSON.stringify(requestBody, null, 2),
		);

		const { data } = await axios.post(
			`${BASE_URL}/v1/billing/subscriptions`,
			requestBody,
			{
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
					Prefer: "return=representation",
				},
			},
		);

		console.log("PayPal Response:", JSON.stringify(data, null, 2));
		console.log("========================================");

		return {
			paypal_subscription_id: data.id,
			status: data.status,
			approve_url: data.links.find(
				(link: any) => link.rel === "approve",
			)?.href,
		};
	} catch (error: any) {
		console.log("========================================");
		console.log("PAYPAL SUBSCRIPTION ERROR");
		console.log("Status:", error.response?.status);
		console.log(
			"Response:",
			JSON.stringify(error.response?.data, null, 2),
		);
		console.log(
			"Headers:",
			JSON.stringify(error.response?.headers, null, 2),
		);
		console.log("========================================");

		throw error;
	}
}

// export async function createPaypalSubscription(paypalPlanId: string) {
// 	const token = await getAccessToken();

// 	const { data } = await axios.post(
// 		`${BASE_URL}/v1/billing/subscriptions`,
// 		{
// 			plan_id: paypalPlanId,

// 			application_context: {
// 				brand_name: 'MyPageSEO',
// 				locale: 'en-US',
// 				shipping_preference: 'NO_SHIPPING',
// 				user_action: 'SUBSCRIBE_NOW',

// 				return_url: `${process.env.FRONTEND_URL}/payment/success`,
// 				cancel_url: `${process.env.FRONTEND_URL}/payment/cancel`,
// 			},
// 		},
// 		{
// 			headers: {
// 				Authorization: `Bearer ${token}`,
// 				'Content-Type': 'application/json',
// 				Prefer: 'return=representation',
// 			},
// 		},
// 	);

// 	return {
// 		paypal_subscription_id: data.id,

// 		status: data.status,

// 		approve_url: data.links.find((link: any) => link.rel === 'approve')
// 			?.href,
// 	};
// }

export const getPaypalSubscription = async (subscriptionId: string) => {
	try {
		const accessToken = await getAccessToken();

		const response = await axios.get(
			`${BASE_URL}/v1/billing/subscriptions/${subscriptionId}`,
			{
				headers: {
					Authorization: `Bearer ${accessToken}`,
					'Content-Type': 'application/json',
				},
			},
		);

		return response.data;
	} catch (error: any) {
		console.error(
			'PayPal Get Subscription Error:',
			error.response?.data || error.message,
		);
		throw error;
	}
};

export const handlePaymentCompleted = async (resource: any) => {
	try {
		console.log('==================================');
		console.log('Payment Completed');
		console.log(resource.id);

		const paypalSubscriptionId =
			resource.billing_agreement_id ||
			resource.billing_agreement_id?.toString();

		if (!paypalSubscriptionId) {
			console.log('Subscription ID not found.');
			return;
		}

		const payment = await Payment.findOne({
			paypal_subscription_id: paypalSubscriptionId,
		});

		if (!payment) {
			console.log('Payment not found.');
			return;
		}

		// Ignore duplicate PAYMENT.SALE.COMPLETED events
		if (payment.status === 'SUCCESS') {
			console.log(
				'Payment already processed. Ignoring duplicate webhook.',
			);
			return;
		}

		const plan = await SubscriptionPlan.findById(payment.plan_id);

		if (!plan) {
			console.log('Subscription plan not found.');
			return;
		}

		// Fetch latest subscription details from PayPal
		const paypalSubscription =
			await getPaypalSubscription(paypalSubscriptionId);

		const subscriber = paypalSubscription?.subscriber;

		// PayPal Details
		const paypalEmail =
			subscriber?.email_address || null;

		const paypalName = `${subscriber?.name?.given_name || ''} ${
			subscriber?.name?.surname || ''
		}`.trim();

		// Business Details (preferred)
		const businessEmail =
			payment.business_details?.business_email ||
			payment.customer_email ||
			null;

		const businessName =
			payment.business_details?.full_name ||
			payment.customer_name ||
			null;

		const email = businessEmail || paypalEmail;

		const fullName =
			businessName || paypalName || 'Customer';

		// Update Payment
		payment.customer_name = fullName;
		payment.customer_email = email;

		payment.subscription_status = (
			paypalSubscription.status || ''
		).toLowerCase();

		payment.subscription_start_date =
			paypalSubscription.start_time
				? new Date(paypalSubscription.start_time)
				: new Date();

		payment.status = 'SUCCESS';

		await payment.save();

		// Mark coupon as used
		// if (payment.coupon_id) {
		// 	await Coupon.findByIdAndUpdate(
		// 		payment.coupon_id,
		// 		{
		// 			is_used: true,
		// 		},
		// 	);
		// }

		// Send Welcome Email ONLY ONCE
		if (email) {
			try {
				console.log('==================================');
				console.log('Sending Welcome Email');
				console.log('To:', email);

				await sendSubscriptionWelcomeMail(
					email,
					fullName,
					// plan.name,
				);

				console.log('Welcome Email Sent');
				console.log('==================================');
			} catch (error) {
				console.error(
					'Failed to send welcome email:',
					error,
				);
			}
		}

		console.log('Payment processed successfully.');
		console.log('==================================');
	} catch (err) {
		console.error('Payment Completed Error:', err);
		throw err;
	}
};

export const handleSubscriptionCreated = async (resource: any) => {
	console.log('Subscription Created');

	await Payment.findOneAndUpdate(
		{
			paypal_subscription_id: resource.id,
		},
		{
			subscription_status: 'created',
		},
	);
};

export const handleSubscriptionActivated = async (resource: any) => {
	console.log('Subscription Activated');

	await Payment.findOneAndUpdate(
		{
			paypal_subscription_id: resource.id,
		},
		{
			subscription_status: 'active',
			subscription_start_date: resource.start_time
				? new Date(resource.start_time)
				: new Date(),
		},
	);
};

export const handleSubscriptionUpdated = async (resource: any) => {
	console.log('Subscription Updated');

	await Payment.findOneAndUpdate(
		{
			paypal_subscription_id: resource.id,
		},
		{},
	);
};

export const handleSubscriptionSuspended = async (resource: any) => {
	console.log('Subscription Suspended');

	await Payment.findOneAndUpdate(
		{
			paypal_subscription_id: resource.id,
		},
		{
			subscription_status: 'suspended',
		},
	);
};

export const handleSubscriptionCancelled = async (resource: any) => {
	console.log('Subscription Cancelled');

	await Payment.findOneAndUpdate(
		{
			paypal_subscription_id: resource.id,
		},
		{
			subscription_status: 'cancelled',
			status: 'CANCELLED',
		},
	);
};

export const handleSubscriptionExpired = async (resource: any) => {
	console.log('Subscription Expired');

	await Payment.findOneAndUpdate(
		{
			paypal_subscription_id: resource.id,
		},
		{
			subscription_status: 'expired',
		},
	);
};

export const handlePaymentDenied = async (resource: any) => {
	console.log('Payment Denied');

	const paypalSubscriptionId = resource.billing_agreement_id;

	if (!paypalSubscriptionId) {
		return;
	}

	await Payment.findOneAndUpdate(
		{
			paypal_subscription_id: paypalSubscriptionId,
		},
		{
			status: 'FAILED',
			subscription_status: 'suspended',
		},
	);
};

export const handlePaymentRefunded = async (resource: any) => {
	console.log('Payment Refunded');

	const paypalSubscriptionId = resource.billing_agreement_id;

	if (!paypalSubscriptionId) {
		return;
	}

	await Payment.findOneAndUpdate(
		{
			paypal_subscription_id: paypalSubscriptionId,
		},
		{
			status: 'CANCELLED',
			subscription_status: 'cancelled',
		},
	);
};

export const handleSubscriptionPaymentFailed = async (resource: any) => {
	console.log('Subscription Payment Failed');

	const paypalSubscriptionId = resource.billing_agreement_id || resource.id;

	if (!paypalSubscriptionId) {
		return;
	}

	await Payment.findOneAndUpdate(
		{
			paypal_subscription_id: paypalSubscriptionId,
		},
		{
			status: 'FAILED',
			subscription_status: 'suspended',
		},
	);
};
