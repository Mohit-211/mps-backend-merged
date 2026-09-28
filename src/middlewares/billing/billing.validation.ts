import Joi from 'joi';
import httpStatus from 'http-status';
import { catchAsync, pick, responseWrapper } from '../../utils';

// Billing request validation (Phase 13a).

const validate = (schema: Joi.Schema, source: 'body' | 'query', keys: string[], local: string) =>
	catchAsync(async (req, res, next) => {
		const { value, error } = schema.validate(pick(source === 'body' ? req.body ?? {} : req.query, keys));
		if (error) return responseWrapper(res, '', error.message, httpStatus.BAD_REQUEST);
		res.locals[local] = value;
		next();
	});

const objectId = Joi.string().hex().length(24);
const coupon = Joi.string().trim().max(40).pattern(/^[A-Za-z0-9_-]+$/);
const text = (max: number) => Joi.string().trim().max(max).allow('', null);

export const validateSlotsQuote = validate(Joi.object({ quantity: Joi.number().integer().min(1).max(100).default(1) }), 'query', ['quantity'], 'slotsInput');
export const validateSlotsBuy = validate(Joi.object({ quantity: Joi.number().integer().min(1).max(100).required() }), 'body', ['quantity'], 'slotsInput');
export const validateTokenCheckout = validate(Joi.object({ pack_id: objectId.required(), coupon_code: coupon.allow('', null) }), 'body', ['pack_id', 'coupon_code'], 'tokenInput');
export const validateCoupon = validate(Joi.object({ pack_id: objectId.required(), coupon_code: coupon.required() }), 'body', ['pack_id', 'coupon_code'], 'tokenInput');
export const validateCancel = validate(Joi.object({ reason: text(127) }), 'body', ['reason'], 'cancelInput');
export const validatePage = validate(
	Joi.object({ page: Joi.number().integer().min(1).default(1), limit: Joi.number().integer().min(1).max(100).default(20) }),
	'query',
	['page', 'limit'],
	'pageInput',
);
export const validateDetails = validate(
	Joi.object({
		name: text(150),
		email: Joi.string().trim().lowercase().email({ tlds: { allow: false } }).max(200).allow('', null),
		address_line1: text(200),
		address_line2: text(200),
		city: text(100),
		region: text(100),
		postal_code: text(20),
		country: text(60),
	}).min(1),
	'body',
	['name', 'email', 'address_line1', 'address_line2', 'city', 'region', 'postal_code', 'country'],
	'detailsInput',
);
export const validatePricing = validate(Joi.object({ country: Joi.string().trim().uppercase().valid('US', 'CA').default('US') }), 'query', ['country'], 'pricingInput');
