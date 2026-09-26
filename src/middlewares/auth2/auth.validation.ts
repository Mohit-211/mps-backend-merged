import Joi from 'joi';
import httpStatus from 'http-status';
import { catchAsync, pick, responseWrapper } from '../../utils';

// Validation for the Phase 8 /auth endpoints. Validated input goes on res.locals.authInput.

const email = Joi.string().trim().lowercase().email({ tlds: { allow: false } }).max(200);
const password = Joi.string()
	.min(8)
	.max(128)
	.pattern(/[A-Za-z]/, 'a letter')
	.pattern(/\d/, 'a digit')
	.messages({ 'string.pattern.name': 'password must contain {#name}' });
const code = Joi.string().trim().pattern(/^\d{6}$/).messages({ 'string.pattern.base': 'code must be 6 digits' });

const validator = (schema: Joi.ObjectSchema, fields: string[]) =>
	catchAsync(async (req, res, next) => {
		const { value, error } = schema.validate(pick(req.body ?? {}, fields));
		if (error) return responseWrapper(res, '', error.message, httpStatus.BAD_REQUEST);
		res.locals.authInput = value;
		next();
	});

export const validateSignup = validator(
	Joi.object({
		account_type: Joi.string().valid('business', 'agency').required(),
		name: Joi.string().trim().min(1).max(150).required(),
		email: email.required(),
		password: password.required(),
		organization_name: Joi.string().trim().min(1).max(150).required(),
		country: Joi.string().valid('US', 'CA').required(),
		accept_terms: Joi.boolean().valid(true).required().messages({ 'any.only': 'accept_terms must be true' }),
	}),
	['account_type', 'name', 'email', 'password', 'organization_name', 'country', 'accept_terms'],
);

export const validateVerifyEmail = validator(Joi.object({ email: email.required(), code: code.required() }), ['email', 'code']);
export const validateEmailOnly = validator(Joi.object({ email: email.required() }), ['email']);
export const validateLogin = validator(Joi.object({ email: email.required(), password: Joi.string().max(128).required() }), ['email', 'password']);
export const validateResetPassword = validator(Joi.object({ email: email.required(), code: code.required(), password: password.required() }), [
	'email',
	'code',
	'password',
]);
