import Joi from 'joi';
import httpStatus from 'http-status';
import { passwordRule } from '../auth2/auth.validation';
import { catchAsync, isValidMongoObjectId, pick, responseWrapper } from '../../utils';

// 13b: validation for /admin/auth and /admin/admins. Validated input goes on res.locals.input.

const email = Joi.string().trim().lowercase().email({ tlds: { allow: false } }).max(100);
const name = Joi.string().trim().min(1).max(200);
const roleId = Joi.number().integer();

const validator = (schema: Joi.ObjectSchema, fields: string[], source: 'body' | 'query' = 'body') =>
	catchAsync(async (req, res, next) => {
		const { value, error } = schema.validate(pick((source === 'body' ? req.body : req.query) ?? {}, fields));
		if (error) return responseWrapper(res, '', error.message, httpStatus.BAD_REQUEST);
		res.locals.input = value;
		next();
	});

export const validateLogin = validator(Joi.object({ email: email.required(), password: Joi.string().max(128).required() }), ['email', 'password']);
export const validateForgotPassword = validator(Joi.object({ email: email.required() }), ['email']);
// confirm_password is compared in the service (400 passwords_do_not_match); a bad token answers link_invalid there.
export const validateResetPassword = validator(
	Joi.object({ token: Joi.string().trim().max(256).required(), password: passwordRule.required(), confirm_password: Joi.string().max(128).required() }),
	['token', 'password', 'confirm_password'],
);
export const validateChangePassword = validator(
	Joi.object({ current_password: Joi.string().max(128).required(), new_password: passwordRule.required(), confirm_password: Joi.string().max(128).required() }),
	['current_password', 'new_password', 'confirm_password'],
);
export const validateListAdmins = validator(Joi.object({ active: Joi.boolean() }), ['active'], 'query');
export const validateCreateAdmin = validator(Joi.object({ name: name.required(), email: email.required(), role_id: roleId.required() }), ['name', 'email', 'role_id']);
export const validateUpdateAdmin = validator(Joi.object({ name, email, role_id: roleId, is_active: Joi.boolean() }).min(1), ['name', 'email', 'role_id', 'is_active']);

/** 404 for an :adminId that isn't an ObjectId (the same answer as an unknown admin). */
export const validateAdminIdParam = catchAsync(async (req, res, next) => {
	if (!isValidMongoObjectId(req.params.adminId)) return responseWrapper(res, '', 'Admin not found.', httpStatus.NOT_FOUND);
	next();
});
