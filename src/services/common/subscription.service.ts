import httpStatus from 'http-status';
import randomize from 'randomatic';
import {
	Coupon,
	Payment,
	SubscriptionPlan,
	User,
	UserSubscription,
} from '../../models';
import { ApiError } from '../../utils';
import {
	createPaypalBillingPlan,
	createPaypalProduct,
	createPaypalSubscription,
	handlePaymentCompleted,
	handlePaymentDenied,
	handlePaymentRefunded,
	handleSubscriptionActivated,
	handleSubscriptionCancelled,
	handleSubscriptionCreated,
	handleSubscriptionExpired,
	handleSubscriptionPaymentFailed,
	handleSubscriptionSuspended,
	handleSubscriptionUpdated,
} from './paypal.service';
import { sendSubscriptionWelcomeMail } from './email.service';

export const createPlan = async (body: any) => {
	try {
		const {
			name,
			description,
			country,
			currency,
			monthly_price,
			setup_fee,
		} = body;

		const existingPlan = await SubscriptionPlan.findOne({
			name,
			country,
			is_active: true,
		});

		if (existingPlan) {
			throw new ApiError(
				httpStatus.BAD_REQUEST,
				'Plan already exists for this country.',
			);
		}

		// ---------------------------------------
		// Create Mongo document FIRST
		// ---------------------------------------

		const plan = await SubscriptionPlan.create({
			name,
			description,
			country,
			currency,
			monthly_price,
			setup_fee,
			paypal_product_id: null,
			paypal_plan_id: null,
		});

		try {
			// ---------------------------------------
			// Reuse PayPal Product if available
			// ---------------------------------------

			let paypalProductId: string;

			const existingPaypalProduct = await SubscriptionPlan.findOne({
				_id: { $ne: plan._id },
				paypal_product_id: { $ne: null },
			});

			if (existingPaypalProduct?.paypal_product_id) {
				paypalProductId = existingPaypalProduct.paypal_product_id;
			} else {
				const paypalProduct = await createPaypalProduct(
					'MyPageSEO Platform',
					'MyPageSEO Subscription Plans',
				);

				paypalProductId = paypalProduct.id;
			}

			// ---------------------------------------
			// Create PayPal Billing Plan
			// ---------------------------------------

			const paypalPlan = await createPaypalBillingPlan(
				paypalProductId,
				name,
				description || `${name} Monthly Subscription`,
				currency,
				monthly_price,
				setup_fee,
			);

			// ---------------------------------------
			// Update Mongo
			// ---------------------------------------

			plan.paypal_product_id = paypalProductId;
			plan.paypal_plan_id = paypalPlan.id;

			await plan.save();

			return plan;
		} catch (paypalError) {
			// Rollback Mongo document
			await SubscriptionPlan.findByIdAndDelete(plan._id);

			throw paypalError;
		}
	} catch (error: any) {
		console.error(
			'PayPal Create Plan Error:',
			error?.response?.data || error,
		);

		throw new ApiError(
			error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
			error?.response?.data?.message ||
				error.message ||
				'Failed to create PayPal plan.',
		);
	}
};

export const getAllPlans = async () => {
	try {
		return await SubscriptionPlan.find({
			is_active: true,
		}).sort({
			country: 1,
			monthly_price: 1,
		});
	} catch (error) {
		throw new ApiError(
			error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

export const getPlansByCountry = async (country: string) => {
	try {
		if (!country) {
			throw new ApiError(httpStatus.BAD_REQUEST, 'Country is required.');
		}

		return await SubscriptionPlan.find({
			country,
			is_active: true,
		}).sort({
			monthly_price: 1,
		});
	} catch (error) {
		throw new ApiError(
			error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

export const updatePlan = async (plan_id: string, body: any) => {
	try {
		const {
			name,
			description,
			country,
			currency,
			monthly_price,
			setup_fee,
		} = body;

		const plan = await SubscriptionPlan.findOne({
			_id: plan_id,
			is_active: true,
		});

		if (!plan) {
			throw new ApiError(httpStatus.NOT_FOUND, 'Plan not found.');
		}

		const existingPlan = await SubscriptionPlan.findOne({
			_id: { $ne: plan_id },
			name,
			country,
			is_active: true,
		});

		if (existingPlan) {
			throw new ApiError(
				httpStatus.BAD_REQUEST,
				'Plan already exists for this country.',
			);
		}

		plan.name = name;
		plan.description = description;
		plan.country = country;
		plan.currency = currency;
		plan.monthly_price = monthly_price;
		plan.setup_fee = setup_fee;

		await plan.save();

		return plan;
	} catch (error) {
		throw new ApiError(
			error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

export const deletePlan = async (plan_id: string) => {
	try {
		const plan = await SubscriptionPlan.findOne({
			_id: plan_id,
			is_active: true,
		});

		if (!plan) {
			throw new ApiError(httpStatus.NOT_FOUND, 'Plan not found.');
		}

		plan.is_active = false;

		await plan.save();

		return {
			message: 'Plan deleted successfully.',
		};
	} catch (error) {
		throw new ApiError(
			error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

export const generateCoupon = async (body: any) => {
	try {
		const { amount } = body;

		const discountAmount = Number(amount);

		if (
			!Number.isInteger(discountAmount) ||
			discountAmount < 1 ||
			discountAmount > 900
		) {
			throw new ApiError(
				httpStatus.BAD_REQUEST,
				'Coupon amount must be between $1 and $900.',
			);
		}

		const code = `GUSD${discountAmount}`;

		const existingCoupon = await Coupon.findOne({
			code,
		});

		if (existingCoupon) {
			throw new ApiError(
				httpStatus.BAD_REQUEST,
				`Coupon ${code} already exists.`,
			);
		}

		// Coupon expires 1 year from creation
		const expiresAt = new Date();

		expiresAt.setFullYear(
			expiresAt.getFullYear() + 1,
		);

		const couponDoc = await Coupon.create({
			code,
			plan_id: null,
			original_amount: 0,
			discount_amount: discountAmount,
			final_amount: 0,
			expires_at: expiresAt,
			used_by: null,
			is_used: false,
			is_active: true,
		});

		if (!couponDoc) {
			throw new ApiError(
				httpStatus.INTERNAL_SERVER_ERROR,
				'Failed to generate coupon.',
			);
		}

		return couponDoc;
	} catch (error: any) {
		throw new ApiError(
			error.statusCode ||
				httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

export const validateCoupon = async (body: any) => {
	try {
		const {
			coupon_code,
			plan_id,
		} = body;

		if (!coupon_code) {
			throw new ApiError(
				httpStatus.BAD_REQUEST,
				'Coupon code is required.',
			);
		}

		if (!plan_id) {
			throw new ApiError(
				httpStatus.BAD_REQUEST,
				'Plan is required.',
			);
		}

		const plan = await SubscriptionPlan.findById(plan_id);

		if (!plan || !plan.is_active) {
			throw new ApiError(
				httpStatus.BAD_REQUEST,
				'Invalid plan selected.',
			);
		}

		const coupon = await Coupon.findOne({
			code: coupon_code.trim().toUpperCase(),
			is_active: true,
		});

		if (!coupon) {
			throw new ApiError(
				httpStatus.BAD_REQUEST,
				'Invalid coupon code.',
			);
		}

		if (coupon.expires_at < new Date()) {
			throw new ApiError(
				httpStatus.BAD_REQUEST,
				'Coupon has expired.',
			);
		}

		const codeUpper = coupon.code.toUpperCase();

	

	if (codeUpper.startsWith('GUSD')) {
	const discountAmount = Number(
		codeUpper.replace('GUSD', ''),
	);

	if (
		!Number.isInteger(discountAmount) ||
		discountAmount < 1 ||
		discountAmount > 900
	) {
		throw new ApiError(
			httpStatus.BAD_REQUEST,
			'Invalid GUSD coupon.',
		);
	}

	const finalSetupFee = Math.max(
		0,
		plan.setup_fee - discountAmount,
	);

	const finalAmount =
		finalSetupFee + plan.monthly_price;

	return {
		valid: true,

		coupon_id: coupon._id,
		plan_id: plan._id,

		plan_name: plan.name,

		monthly_amount:
			plan.monthly_price,

		setup_fee:
			finalSetupFee,

		original_amount:
			plan.setup_fee +
			plan.monthly_price,

		discount_amount:
			Math.min(
				discountAmount,
				plan.setup_fee,
			),

		final_amount:
			finalAmount,

		discount_type:
			'FIXED_SETUP',
	};
}

		// ========================================
		// EXISTING GUS / SK PERCENTAGE COUPONS
		// ========================================

		if (
			codeUpper.startsWith('GUS') ||
			codeUpper.startsWith('SK')
		) {
			const percent =
				parseInt(
					codeUpper.replace(/[^0-9]/g, ''),
				) || 0;

			const discountOnSetup = Math.round(
				(plan.setup_fee * percent) / 100,
			);

			const finalSetupFee = Math.max(
				0,
				plan.setup_fee - discountOnSetup,
			);

			return {
				valid: true,

				coupon_id: coupon._id,
				plan_id: plan._id,

				plan_name: plan.name,

				monthly_amount: plan.monthly_price,

				setup_fee: finalSetupFee,

				original_amount:
					plan.setup_fee + plan.monthly_price,

				discount_amount: discountOnSetup,

				final_amount:
					finalSetupFee +
					plan.monthly_price,

				discountPercent: percent,
			};
		}

		// ========================================
		// EXISTING FIXED COUPONS
		// ========================================

		if (
			coupon.plan_id &&
			coupon.plan_id.toString() !==
				plan._id.toString()
		) {
			throw new ApiError(
				httpStatus.BAD_REQUEST,
				'Coupon is not valid for this plan.',
			);
		}

		return {
			valid: true,

			coupon_id: coupon._id,
			plan_id: plan._id,

			plan_name: plan.name,

			monthly_amount: plan.monthly_price,

			setup_fee: plan.setup_fee,

			original_amount: coupon.original_amount,

			discount_amount: coupon.discount_amount,

			final_amount: coupon.final_amount,
		};
	} catch (error: any) {
		throw new ApiError(
			error.statusCode ||
				httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

export const getAllCoupons = async (query: any) => {
	try {
		const { page = 1, limit = 100, search, status = 'ALL' } = query;

		const filter: any = {};

		// Search by coupon code 
		if (search) {
			filter.code = {
				$regex: search,
				$options: 'i',
			};
		}

		// Filter by status
		switch (status) {
			case 'ACTIVE':
				filter.is_active = true;
				filter.is_used = false;
				filter.expires_at = {
					$gte: new Date(),
				};
				break;

			case 'USED':
				filter.is_used = true;
				break;

			case 'EXPIRED':
				filter.is_used = false;
				filter.expires_at = {
					$lt: new Date(),
				};
				break;

			default:
				break;
		}

		const skip = (Number(page) - 1) * Number(limit);

		const [coupons, total] = await Promise.all([
			Coupon.find(filter)
				.populate('plan_id', 'name monthly_price setup_fee currency country')
				.sort({
					created_at: -1,
				})
				.skip(skip)
				.limit(Number(limit)),

			Coupon.countDocuments(filter),
		]);

		const data = coupons.map((coupon: any) => {
			let couponStatus = 'ACTIVE';

			if (coupon.is_used) {
				couponStatus = 'USED';
			} else if (coupon.expires_at < new Date()) {
				couponStatus = 'EXPIRED';
			}

			return {
				...coupon.toObject(),
				status: couponStatus,
			};
		});

		return {
			data,
			total,
			page: Number(page),
			limit: Number(limit),
			totalPages: Math.ceil(total / Number(limit)),
		};
	} catch (error: any) {
		throw new ApiError(
			error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

export const createSubscription = async (body: any) => {
	try {
		const {
			plan_id,
			coupon_code,
			business_details,
		} = body;

		if (!plan_id) {
			throw new ApiError(
				httpStatus.BAD_REQUEST,
				'Plan is required.',
			);
		}

		const plan = await SubscriptionPlan.findById(plan_id);

		if (!plan || !plan.is_active) {
			throw new ApiError(
				httpStatus.NOT_FOUND,
				'Subscription plan not found.',
			);
		}

		let coupon: any = null;

		// ========================================
		// Validate Coupon
		// ========================================

		if (coupon_code) {
			const codeUpper =
				coupon_code.trim().toUpperCase();

			// ------------------------------------
			// GUSD coupons are reusable
			// ------------------------------------

			if (codeUpper.startsWith('GUSD')) {
				coupon = await Coupon.findOne({
					code: codeUpper,
					is_active: true,
				});
			} else {
				// --------------------------------
				// Existing coupons remain
				// single-use behavior
				// --------------------------------

				coupon = await Coupon.findOne({
					code: codeUpper,
					is_active: true,
					is_used: false,
				});
			}

			if (!coupon) {
				throw new ApiError(
					httpStatus.BAD_REQUEST,
					'Invalid coupon.',
				);
			}

			if (coupon.expires_at < new Date()) {
				throw new ApiError(
					httpStatus.BAD_REQUEST,
					'Coupon expired.',
				);
			}
		}

		// ========================================
		// Calculate Amounts
		// ========================================

		let finalSetupFee = plan.setup_fee;

		let discountAmount = 0;

		let finalAmount =
			plan.setup_fee +
			plan.monthly_price;

		if (coupon) {
			const codeUpper =
				coupon.code.toUpperCase();

			// ====================================
			// GUSD FIXED SETUP DISCOUNT
			// ====================================

			if (codeUpper.startsWith('GUSD')) {
				const fixedDiscount =
					Number(
						codeUpper.replace('GUSD', ''),
					);

				// if (
				// 	!Number.isInteger(fixedDiscount) ||
				// 	fixedDiscount < 5 ||
				// 	fixedDiscount > 300
				// ) {
				// 	throw new ApiError(
				// 		httpStatus.BAD_REQUEST,
				// 		'Invalid GUSD coupon.',
				// 	);
				// }

				// Never allow setup fee below zero
				discountAmount = Math.min(
					fixedDiscount,
					plan.setup_fee,
				);

				finalSetupFee = Math.max(
					0,
					plan.setup_fee -
						discountAmount,
				);

				// Monthly subscription is NOT discounted
				finalAmount =
					finalSetupFee +
					plan.monthly_price;
			}

			// ====================================
			// EXISTING GUS / SK
			// ====================================

			else if (
				codeUpper.startsWith('GUS') ||
				codeUpper.startsWith('SK')
			) {
				const percent =
					parseInt(
						codeUpper.replace(
							/[^0-9]/g,
							'',
						),
					) || 0;

				discountAmount = Math.round(
					(plan.setup_fee * percent) /
						100,
				);

				finalSetupFee = Math.max(
					0,
					plan.setup_fee -
						discountAmount,
				);

				finalAmount =
					finalSetupFee +
					plan.monthly_price;
			}

			// ====================================
			// HAPPYDISCOUNT
			// ====================================

			else if (
				codeUpper === 'HAPPYDISCOUNT'
			) {
				finalSetupFee = 0;

				finalAmount =
					plan.monthly_price;

				discountAmount =
					plan.setup_fee;
			}

			// ====================================
			// EXISTING NORMAL FIXED COUPONS
			// ====================================

			else {
				if (
					coupon.plan_id &&
					coupon.plan_id.toString() !==
						plan._id.toString()
				) {
					throw new ApiError(
						httpStatus.BAD_REQUEST,
						"Coupon doesn't belong to this plan.",
					);
				}

				discountAmount =
					coupon.discount_amount;

				finalSetupFee = Math.max(
					0,
					plan.setup_fee -
						discountAmount,
				);

				finalAmount =
					finalSetupFee +
					plan.monthly_price;
			}
		}

		// ========================================
		// Create PayPal Subscription
		// ========================================

		const paypalSubscription =
			await createPaypalSubscription(
				plan.paypal_plan_id,
				finalSetupFee,
				plan.currency,
			);

		// ========================================
		// Save Payment
		// ========================================

		const payment = await Payment.create({
			payment_type: 'SUBSCRIPTION',

			status: 'PENDING',

			plan_id: plan._id,

			coupon_id:
				coupon?._id || null,

			paypal_subscription_id:
				paypalSubscription.paypal_subscription_id,

			paypal_plan_id:
				plan.paypal_plan_id,

			amount: finalAmount,

			monthly_amount:
				plan.monthly_price,

			setup_fee:
				finalSetupFee,

			discount_amount:
				discountAmount,

			final_amount:
				finalAmount,

			currency:
				plan.currency,

			customer_name:
				business_details?.full_name ||
				null,

			customer_email:
				business_details?.business_email ||
				null,

			customer_mobile:
				business_details?.phone_number ||
				null,

			business_details:
				business_details || null,

			subscription_status:
				'created',
		});

		return {
			payment_id: payment._id,

			paypal_subscription_id:
				paypalSubscription.paypal_subscription_id,

			approve_url:
				paypalSubscription.approve_url,

			status:
				paypalSubscription.status,

			final_amount:
				finalAmount,

			setup_fee:
				finalSetupFee,
		};
	} catch (error: any) {
		throw new ApiError(
			error.statusCode ||
				httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

// export const createSubscription = async (body: any) => {
// 	try {
// 		const { plan_id, coupon_code, business_details } = body;

// 		if (!plan_id) {
// 			throw new ApiError(httpStatus.BAD_REQUEST, 'Plan is required.');
// 		}

// 		const plan = await SubscriptionPlan.findById(plan_id);

// 		if (!plan || !plan.is_active) {
// 			throw new ApiError(httpStatus.NOT_FOUND, 'Subscription plan not found.');
// 		}

// 		let coupon: any = null;
// 		let isHappyDiscount = false;

// 		if (coupon_code) {
// 			coupon = await Coupon.findOne({
// 				code: coupon_code.toUpperCase(),
// 				is_active: true,
// 				is_used: false,
// 			});

// 			if (!coupon) {
// 				throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid coupon.');
// 			}

// 			if (coupon.code === "HAPPYDISCOUNT") {
// 				isHappyDiscount = true;
// 			} else if (coupon.plan_id && coupon.plan_id.toString() !== plan._id.toString()) {
// 				throw new ApiError(httpStatus.BAD_REQUEST, "Coupon doesn't belong to this plan.");
// 			}

// 			if (coupon.expires_at < new Date()) {
// 				throw new ApiError(httpStatus.BAD_REQUEST, 'Coupon expired.');
// 			}
// 		}

// 		// ========================================
// 		// Calculate amounts
// 		// ========================================
// 		let finalSetupFee = plan.setup_fee;
// 		let discountAmount = 0;
// 		let finalAmount = plan.setup_fee + plan.monthly_price;

// 		if (isHappyDiscount) {
// 			finalSetupFee = 0;                        // ← Changed to 0
// 			finalAmount = plan.monthly_price;         // First payment = only monthly fee
// 			discountAmount = plan.setup_fee;
// 		} else if (coupon) {
// 			discountAmount = coupon.discount_amount;
// 			finalAmount = coupon.final_amount;
// 			finalSetupFee = Math.max(0, plan.setup_fee - discountAmount);
// 		}

// 		// Create PayPal Subscription
// 		const paypalSubscription = await createPaypalSubscription(
// 			plan.paypal_plan_id,
// 			finalSetupFee,
// 			plan.currency,
// 		);

// 		// Save Payment
// 		const payment = await Payment.create({
// 			payment_type: 'SUBSCRIPTION',
// 			status: 'PENDING',
// 			plan_id: plan._id,
// 			coupon_id: coupon?._id || null,
// 			paypal_subscription_id: paypalSubscription.paypal_subscription_id,
// 			paypal_plan_id: plan.paypal_plan_id,

// 			amount: finalAmount,
// 			monthly_amount: plan.monthly_price,
// 			setup_fee: finalSetupFee,
// 			discount_amount: discountAmount,
// 			final_amount: finalAmount,

// 			currency: plan.currency,
// 			customer_name: business_details?.full_name || null,
// 			customer_email: business_details?.business_email || null,
// 			customer_mobile: business_details?.phone_number || null,
// 			business_details: business_details || null,
// 			subscription_status: 'created',
// 		});

// 		return {
// 			payment_id: payment._id,
// 			paypal_subscription_id: paypalSubscription.paypal_subscription_id,
// 			approve_url: paypalSubscription.approve_url,
// 			status: paypalSubscription.status,
// 			final_amount: finalAmount,
// 			setup_fee: finalSetupFee
// 		};
// 	} catch (error: any) {
// 		throw new ApiError(
// 			error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
// 			error.message,
// 		);
// 	}
// };
// export const createSubscription = async (body: any) => {
// 	try {
// 		const { plan_id, coupon_code, business_details } = body;
		

// 		if (!plan_id) {
// 			throw new ApiError(httpStatus.BAD_REQUEST, 'Plan is required.');
// 		}


// 		const plan = await SubscriptionPlan.findById(plan_id);

// 		if (!plan || !plan.is_active) {
// 			throw new ApiError(
// 				httpStatus.NOT_FOUND,
// 				'Subscription plan not found.',
// 			);
// 		}


// 		let coupon: any = null;

// 		if (coupon_code) {
// 			coupon = await Coupon.findOne({
// 				code: coupon_code.toUpperCase(),
// 				is_active: true,
// 				is_used: false,
// 			});

// 			if (!coupon) {
// 				throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid coupon.');
// 			}

// 			if (coupon.plan_id.toString() !== plan._id.toString()) {
// 				throw new ApiError(
// 					httpStatus.BAD_REQUEST,
// 					"Coupon doesn't belong to this plan.",
// 				);
// 			}

// 			if (coupon.expires_at < new Date()) {
// 				throw new ApiError(httpStatus.BAD_REQUEST, 'Coupon expired.');
// 			}
// 		}

// 		let finalSetupFee = plan.setup_fee;
// 		let discountAmount = 0;
// 		let finalAmount = plan.setup_fee + plan.monthly_price;

// 		if (coupon) {
// 			discountAmount = coupon.discount_amount;
// 			finalAmount = coupon.final_amount;

// 			// Apply discount to setup fee (recommended for your flow)
// 			finalSetupFee = Math.max(0, plan.setup_fee - discountAmount);
// 		}


// 		const paypalSubscription = await createPaypalSubscription(
// 			plan.paypal_plan_id,
// 			finalSetupFee,
// 			plan.currency,
// 		);

		
// 		const payment = await Payment.create({
// 			payment_type: 'SUBSCRIPTION',

// 			status: 'PENDING',

// 			plan_id: plan._id,

// 			coupon_id: coupon?._id || null,

// 			paypal_subscription_id: paypalSubscription.paypal_subscription_id,

// 			paypal_plan_id: plan.paypal_plan_id,

// 			amount: finalAmount,
// 			monthly_amount: plan.monthly_price,
// 			setup_fee: finalSetupFee, // Important: save actual charged amount
// 			discount_amount: discountAmount,
// 			final_amount: finalAmount,

// 			currency: plan.currency,

// 			customer_name: business_details?.full_name || null,
// 			customer_email: business_details?.business_email || null,
// 			customer_mobile: business_details?.phone_number || null,

// 			business_details: business_details || null,

// 			subscription_status: 'created',
// 		});

// 		return {
// 			payment_id: payment._id,
// 			paypal_subscription_id: paypalSubscription.paypal_subscription_id,
// 			approve_url: paypalSubscription.approve_url,
// 			status: paypalSubscription.status,
// 		};
// 	} catch (error: any) {
// 		throw new ApiError(
// 			error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
// 			error.message,
// 		);
// 	}
// };

// export const createSubscription = async (body: any) => {
// 	try {
// 		const {
// 			plan_id,
// 			coupon_code,
// 			business_details,
// 		} = body;

// 		if (!plan_id) {
// 			throw new ApiError(
// 				httpStatus.BAD_REQUEST,
// 				'Plan is required.',
// 			);
// 		}

// 		// ---------------------------------------
// 		// Validate Plan
// 		// ---------------------------------------

// 		const plan = await SubscriptionPlan.findById(plan_id);

// 		if (!plan || !plan.is_active) {
// 			throw new ApiError(
// 				httpStatus.NOT_FOUND,
// 				'Subscription plan not found.',
// 			);
// 		}

// 		// ---------------------------------------
// 		// Validate Coupon (Optional)
// 		// ---------------------------------------

// 		let coupon: any = null;

// 		if (coupon_code) {
// 			coupon = await Coupon.findOne({
// 				code: coupon_code.toUpperCase(),
// 				is_active: true,
// 				is_used: false,
// 			});

// 			if (!coupon) {
// 				throw new ApiError(
// 					httpStatus.BAD_REQUEST,
// 					'Invalid coupon.',
// 				);
// 			}

// 			if (coupon.plan_id.toString() !== plan._id.toString()) {
// 				throw new ApiError(
// 					httpStatus.BAD_REQUEST,
// 					"Coupon doesn't belong to this plan.",
// 				);
// 			}

// 			if (coupon.expires_at < new Date()) {
// 				throw new ApiError(
// 					httpStatus.BAD_REQUEST,
// 					'Coupon expired.',
// 				);
// 			}
// 		}

// 		// ---------------------------------------
// 		// Create PayPal Subscription
// 		// ---------------------------------------

// 		const paypalSubscription = await createPaypalSubscription(
// 			plan.paypal_plan_id,
// 		);

// 		// ---------------------------------------
// 		// Calculate Amount
// 		// ---------------------------------------

// 		const discountAmount = coupon ? coupon.discount_amount : 0;

// 		const finalAmount = coupon
// 			? coupon.final_amount
// 			: plan.setup_fee + plan.monthly_price;

// 		// ---------------------------------------
// 		// Save Pending Payment
// 		// ---------------------------------------

// 		const payment = await Payment.create({
// 			payment_type: 'SUBSCRIPTION',

// 			status: 'PENDING',

// 			plan_id: plan._id,

// 			coupon_id: coupon?._id || null,

// 			paypal_subscription_id:
// 				paypalSubscription.paypal_subscription_id,

// 			paypal_plan_id: plan.paypal_plan_id,

// 			amount: finalAmount,

// 			monthly_amount: plan.monthly_price,

// 			setup_fee: plan.setup_fee,

// 			discount_amount: discountAmount,

// 			final_amount: finalAmount,

// 			currency: plan.currency,

// 			customer_name: business_details?.full_name || null,

// 			customer_email:
// 				business_details?.business_email || null,

// 			customer_mobile:
// 				business_details?.phone_number || null,

// 			business_details: business_details || null,

// 			subscription_status: 'created',
// 		});

// 		return {
// 			payment_id: payment._id,

// 			paypal_subscription_id:
// 				paypalSubscription.paypal_subscription_id,

// 			approve_url:
// 				paypalSubscription.approve_url,

// 			status: paypalSubscription.status,
// 		};
// 	} catch (error: any) {
// 		throw new ApiError(
// 			error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
// 			error.message,
// 		);
// 	}
// };

export const paypalWebhook = async (event: any) => {
	try {
		console.log('========================================');
		console.log('PAYPAL WEBHOOK RECEIVED');
		console.log('EVENT:', event.event_type);
		console.log(JSON.stringify(event, null, 2));
		console.log('========================================');

		switch (event.event_type) {
			case 'BILLING.SUBSCRIPTION.CREATED':
				await handleSubscriptionCreated(event.resource);
				break;

			case 'BILLING.SUBSCRIPTION.ACTIVATED':
				await handleSubscriptionActivated(event.resource);
				break;

			case 'BILLING.SUBSCRIPTION.UPDATED':
				await handleSubscriptionUpdated(event.resource);
				break;

			case 'BILLING.SUBSCRIPTION.SUSPENDED':
				await handleSubscriptionSuspended(event.resource);
				break;

			case 'BILLING.SUBSCRIPTION.CANCELLED':
				await handleSubscriptionCancelled(event.resource);
				break;

			case 'BILLING.SUBSCRIPTION.EXPIRED':
				await handleSubscriptionExpired(event.resource);
				break;

			case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED':
				await handleSubscriptionPaymentFailed(event.resource);
				break;

			case 'PAYMENT.SALE.COMPLETED':
				await handlePaymentCompleted(event.resource);
				break;

			case 'PAYMENT.SALE.DENIED':
				await handlePaymentDenied(event.resource);
				break;

			case 'PAYMENT.SALE.REFUNDED':
				await handlePaymentRefunded(event.resource);
				break;

			default:
				console.log('Unhandled PayPal Event:', event.event_type);
		}

		return {
			message: 'Webhook processed successfully.',
		};
	} catch (err) {
		console.error('PayPal Webhook Error:', err);
		throw err;
	}
};

export const getPaymentStatus = async (subscriptionId: string) => {
	if (!subscriptionId) {
		throw new ApiError(
			httpStatus.BAD_REQUEST,
			"Subscription ID is required."
		);
	}

	const payment = await Payment.findOne({
		paypal_subscription_id: subscriptionId,
	}).populate("plan_id", "name monthly_price setup_fee");

	if (!payment) {
		throw new ApiError(httpStatus.NOT_FOUND, "Payment not found.");
	}

	return {
		status: payment.status,
		subscription_status: payment.subscription_status,

		customer_name: payment.customer_name,
		customer_email: payment.customer_email,

		subscription_start_date: payment.subscription_start_date,

		plan: payment.plan_id,

		// Pricing Details
		original_amount: payment.amount,
		paid_amount: payment.final_amount,
		discount_amount: payment.discount_amount,
		monthly_amount: payment.monthly_amount,
		setup_fee: payment.setup_fee,
	};
};

// export const cancelSubscription = async (body: any) => {
// 	try {
// 		const { user } = body;

// 		const userDoc = await User.findById(user._id);

// 		if (!userDoc) {
// 			throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
// 		}

// 		userDoc.current_plan_id = null;

// 		userDoc.subscription_status = 'CANCELLED';

// 		const paymentDoc = await Payment.findOne({
// 			user_id: user._id,
// 			status: 'SUCCESS',
// 			is_active: true,
// 		}).sort({ created_at: -1 });

// 		if (!paymentDoc) {
// 			throw new ApiError(httpStatus.NOT_FOUND, 'Subscription not found');
// 		}

// 		await razorpay.subscriptions.cancel(
// 			paymentDoc.razorpay_subscription_id,
// 			true,
// 		);

// 		paymentDoc.subscription_status = 'cancelled';
// 		paymentDoc.is_active = false;

// 		await paymentDoc.save();

// 		await userDoc.save();

// 		await Payment.updateMany(
// 			{
// 				user_id: user._id,
// 				status: 'SUCCESS',
// 			},
// 			{
// 				is_active: false,
// 			},
// 		);

// 		return {
// 			message: 'Subscription cancelled successfully',
// 		};
// 	} catch (error) {
// 		throw new ApiError(
// 			error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
// 			error.message,
// 		);
// 	}
// };

export const getAllPaymentHistory = async (query: any) => {
	try {
		const { limit = 10, offset = 0 } = query;

		const payments = await Payment.find({
			status: 'SUCCESS',
		})
			.populate('user_id', 'user_name email')
			.populate('plan_id', 'name monthly_price setup_fee')
			.populate('coupon_id', 'code')
			.sort({ created_at: -1 })
			.limit(Number(limit))
			.skip(Number(offset));

		return payments;
	} catch (error: any) {
		throw new ApiError(
			error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

export const sendSubscriptionWelcomeMailService = async (
	email: string,
	name?: string,
) => {
	return await sendSubscriptionWelcomeMail(
		email,
		name,
	);
};
