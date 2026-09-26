import Joi from 'joi';
import httpStatus from 'http-status';
import { catchAsync, pick, responseWrapper } from '../../utils';

// Team (Phase 11). Validated input goes on res.locals.teamInput.

const clientIds = Joi.array().items(Joi.string().hex().length(24)).max(100);

const validator = (schema: Joi.ObjectSchema, fields: string[], from: 'body' | 'query' = 'body') =>
	catchAsync(async (req, res, next) => {
		const { value, error } = schema.validate(pick((from === 'body' ? req.body : req.query) ?? {}, fields));
		if (error) return responseWrapper(res, '', error.message, httpStatus.BAD_REQUEST);
		res.locals.teamInput = value;
		next();
	});

export const validateInvite = validator(
	Joi.object({
		email: Joi.string().trim().lowercase().email({ tlds: { allow: false } }).max(200).required(),
		role: Joi.string().valid('member', 'client_user').required(),
		client_ids: clientIds,
	}),
	['email', 'role', 'client_ids'],
);

export const validateInvitationList = validator(Joi.object({ status: Joi.string().valid('pending', 'accepted', 'revoked', 'expired') }), ['status'], 'query');

export const validateRoleChange = validator(
	Joi.object({ role: Joi.string().valid('member', 'client_user').required(), client_ids: clientIds }),
	['role', 'client_ids'],
);

const token = Joi.string().trim().pattern(/^[A-Za-z0-9_-]{20,100}$/).required();

export const validateInspect = validator(Joi.object({ token }), ['token']);

export const validateAccept = validator(
	Joi.object({
		token,
		name: Joi.string().trim().min(1).max(150),
		password: Joi.string().min(8).max(128).pattern(/[A-Za-z]/, 'a letter').pattern(/\d/, 'a digit').messages({ 'string.pattern.name': 'password must contain {#name}' }),
	}),
	['token', 'name', 'password'],
);
