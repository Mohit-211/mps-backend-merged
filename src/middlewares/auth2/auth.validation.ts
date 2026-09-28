import Joi from 'joi';
import httpStatus from 'http-status';
import { catchAsync, pick, responseWrapper } from '../../utils';

// Validation for the Phase 8 /auth endpoints. Validated input goes on res.locals.authInput.

const email = Joi.string().trim().lowercase().email({ tlds: { allow: false } }).max(200);
/** A link token; its format is checked by the service, so a bad one answers 400 link_invalid like an unknown one. */
const linkToken = Joi.string().trim().max(256);
/** The password rules (users and, since 13b, admins). */
export const passwordRule = Joi.string()
	.min(8)
	.max(128)
	.pattern(/[A-Za-z]/, 'a letter')
	.pattern(/\d/, 'a digit')
	.messages({ 'string.pattern.name': 'password must contain {#name}' });
const password = passwordRule;

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

// Phase 8.1: the token from the verification link (base64url, 43 characters for 32 bytes).
export const validateVerifyEmail = validator(
	Joi.object({ token: Joi.string().trim().pattern(/^[A-Za-z0-9_-]{20,128}$/).required().messages({ 'string.pattern.base': 'token is not valid' }) }),
	['token'],
);
export const validateEmailOnly = validator(Joi.object({ email: email.required() }), ['email']);
export const validateLogin = validator(Joi.object({ email: email.required(), password: Joi.string().max(128).required() }), ['email', 'password']);
// 13b: reset by link. confirm_password is compared in the service (400 passwords_do_not_match).
export const validateResetPassword = validator(
	Joi.object({ token: linkToken.required(), password: password.required(), confirm_password: Joi.string().max(128).required() }),
	['token', 'password', 'confirm_password'],
);

// Phase 13b: session and account endpoints.
const refreshToken = Joi.string().trim().max(2000).required();
export const validateRefreshToken = validator(Joi.object({ refresh_token: refreshToken }), ['refresh_token']);
export const validateChangePassword = validator(Joi.object({ current_password: Joi.string().max(128).required(), new_password: password.required() }), ['current_password', 'new_password']);
export const validateUpdateMe = validator(
	Joi.object({ name: Joi.string().trim().min(1).max(150), mobile: Joi.string().trim().max(30).pattern(/^[+\d ()-]*$/).allow('', null) }).min(1),
	['name', 'mobile'],
);
export const validatePasswordOnly = validator(Joi.object({ password: Joi.string().max(128).required() }), ['password']);
