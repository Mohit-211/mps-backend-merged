import Joi from 'joi';
import httpStatus from 'http-status';
import { BILLING_METHODS, CURRENCIES, FEATURES, INVOICE_KINDS, INVOICE_STATUSES, SUBSCRIPTION_STATUSES } from '../../billing/constants';
import { COUPON_DISCOUNT_TYPES } from '../../models';
import { catchAsync, pick, responseWrapper } from '../../utils';

// Billing admin validation (Phase 13a). The validated value is on res.locals.billingInput.

const validate = (schema: Joi.Schema, source: 'body' | 'query', keys: string[]) =>
	catchAsync(async (req, res, next) => {
		const { value, error } = schema.validate(pick(source === 'body' ? req.body ?? {} : req.query, keys));
		if (error) return responseWrapper(res, { reason: 'invalid_input' }, error.message, httpStatus.BAD_REQUEST);
		res.locals.billingInput = value;
		next();
	});

const objectId = Joi.string().hex().length(24);
const money = Joi.number().min(0).max(100000).precision(2);
const page = { page: Joi.number().integer().min(1).default(1), limit: Joi.number().integer().min(1).max(100).default(20) };
const note = Joi.string().trim().max(500);

const planFields = {
	name: Joi.string().trim().min(1).max(120),
	entitlements: Joi.object(Object.fromEntries(FEATURES.map((f) => [f, Joi.boolean()]))),
	users_per_location: Joi.number().integer().min(1).max(100),
	max_locations: Joi.number().integer().min(1).max(10000).allow(null),
	trial: Joi.object({ days: Joi.number().integer().min(0).max(90), locations: Joi.number().integer().min(0).max(100), users: Joi.number().integer().min(1).max(100), tokens: Joi.number().integer().min(0).max(10000) }),
	tokens_per_refresh: Joi.object({ rankings: Joi.number().integer().min(0).max(100), gbp: Joi.number().integer().min(0).max(100) }),
	// Phase 18: tokens per AI action.
	ai_token_costs: Joi.object({
		reply_drafts_per_10: Joi.number().integer().min(0).max(100),
		analysis_per_10: Joi.number().integer().min(0).max(100),
		appeal: Joi.number().integer().min(0).max(100),
		insights: Joi.number().integer().min(0).max(100),
	}),
	monthly_token_grant: Joi.number().integer().min(0).max(100000),
	token_pack_discount_percent: Joi.number().min(0).max(100),
	token_pack_prices: Joi.array().items(Joi.object({ pack_id: objectId.required(), currency: Joi.string().valid(...CURRENCIES).required(), price: money.required() })).max(100),
};
const planKeys = Object.keys(planFields);

export const validatePlanList = validate(Joi.object({ kind: Joi.string().valid('standard', 'custom'), organization_id: objectId }), 'query', ['kind', 'organization_id']);
export const validatePlanUpdate = validate(Joi.object({ ...planFields, is_active: Joi.boolean() }).min(1), 'body', [...planKeys, 'is_active']);
export const validatePrice = validate(
	Joi.object({ currency: Joi.string().valid(...CURRENCIES).required(), first_location_price: money.required(), additional_location_price: money.required(), effective_from: Joi.date().iso().required() }),
	'body',
	['currency', 'first_location_price', 'additional_location_price', 'effective_from'],
);
export const validateCustomPlan = validate(Joi.object({ ...planFields, billing_method: Joi.string().valid(...BILLING_METHODS) }), 'body', [...planKeys, 'billing_method']);
export const validateBillingMethod = validate(Joi.object({ billing_method: Joi.string().valid(...BILLING_METHODS).required() }), 'body', ['billing_method']);
export const validateManualSubscription = validate(
	Joi.object({ quantity: Joi.number().integer().min(1).max(10000).required(), starts_at: Joi.date().iso(), comp_until: Joi.date().iso().allow(null), currency: Joi.string().valid(...CURRENCIES), note: note.allow('', null) }),
	'body',
	['quantity', 'starts_at', 'comp_until', 'currency', 'note'],
);
export const validateTokens = validate(
	Joi.object({ amount: Joi.number().integer().min(-100000).max(100000).invalid(0).required(), type: Joi.string().valid('grant', 'adjustment').default('adjustment'), note: note.required() }),
	'body',
	['amount', 'type', 'note'],
);
export const validatePage = validate(Joi.object(page), 'query', ['page', 'limit']);
export const validateSubscriptionList = validate(
	Joi.object({ ...page, status: Joi.string().valid(...SUBSCRIPTION_STATUSES), billing_method: Joi.string().valid(...BILLING_METHODS), organization_id: objectId }),
	'query',
	['page', 'limit', 'status', 'billing_method', 'organization_id'],
);
export const validateSubscriptionUpdate = validate(
	Joi.object({ comp_until: Joi.date().iso().allow(null), paid_quantity: Joi.number().integer().min(1).max(10000), note: note.allow('', null) }).min(1),
	'body',
	['comp_until', 'paid_quantity', 'note'],
);
export const validateReason = validate(Joi.object({ reason: Joi.string().trim().max(127).allow('', null) }), 'body', ['reason']);
export const validateNote = validate(Joi.object({ note: note.required() }), 'body', ['note']);
export const validateInvoiceList = validate(
	Joi.object({ ...page, status: Joi.string().valid(...INVOICE_STATUSES), kind: Joi.string().valid(...INVOICE_KINDS), organization_id: objectId, q: Joi.string().trim().max(40) }),
	'query',
	['page', 'limit', 'status', 'kind', 'organization_id', 'q'],
);
const packFields = {
	name: Joi.string().trim().min(1).max(80),
	tokens: Joi.number().integer().min(1).max(100000),
	prices: Joi.array().items(Joi.object({ currency: Joi.string().valid(...CURRENCIES).required(), price: money.required() })).min(1).max(2).unique('currency'),
	expires_after_days: Joi.number().integer().min(1).max(3650).allow(null),
	is_active: Joi.boolean(),
	sort_order: Joi.number().integer().min(0).max(1000),
};
export const validatePackCreate = validate(Joi.object({ ...packFields, name: packFields.name.required(), tokens: packFields.tokens.required(), prices: packFields.prices.required() }), 'body', Object.keys(packFields));
export const validatePackUpdate = validate(Joi.object(packFields).min(1), 'body', Object.keys(packFields));
const couponFields = {
	code: Joi.string().trim().uppercase().pattern(/^[A-Z0-9_-]{3,40}$/),
	discount_type: Joi.string().valid(...COUPON_DISCOUNT_TYPES),
	value: Joi.number().min(0).max(100000),
	pack_ids: Joi.array().items(objectId).max(50),
	max_redemptions: Joi.number().integer().min(1).allow(null),
	expires_at: Joi.date().iso().allow(null),
	is_active: Joi.boolean(),
	note: note.allow('', null),
};
export const validateCouponCreate = validate(
	Joi.object({ ...couponFields, code: couponFields.code.required(), discount_type: couponFields.discount_type.required(), value: couponFields.value.required() }).custom((v, h) => (v.discount_type === 'percent' && v.value > 100 ? h.error('any.invalid') : v)),
	'body',
	Object.keys(couponFields),
);
export const validateCouponUpdate = validate(Joi.object({ ...couponFields, code: Joi.forbidden() }).min(1), 'body', Object.keys(couponFields));
export const validateAuditList = validate(Joi.object({ ...page, organization_id: objectId, action: Joi.string().trim().max(60) }), 'query', ['page', 'limit', 'organization_id', 'action']);
