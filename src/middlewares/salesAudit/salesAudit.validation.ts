import Joi from 'joi';
import httpStatus from 'http-status';
import { catchAsync, pick, responseWrapper } from '../../utils';

// Sales audit (Phase 19): request validation. Validated input goes on res.locals.auditInput.

const session = Joi.string().trim().pattern(/^[A-Za-z0-9_-]{8,36}$/).messages({ 'string.pattern.base': 'session must be 8-36 letters, digits, _ or -' });

const validate = (schema: Joi.ObjectSchema, source: 'body' | 'query', keys: string[]) =>
	catchAsync(async (req, res, next) => {
		const { value, error } = schema.validate(pick(source === 'body' ? req.body ?? {} : req.query, keys), { convert: true });
		if (error) return responseWrapper(res, '', error.message, httpStatus.BAD_REQUEST);
		res.locals.auditInput = value;
		next();
	});

export const validateAutocomplete = validate(Joi.object({ input: Joi.string().trim().min(2).max(120).required(), session: session.required() }), 'query', ['input', 'session']);

export const validateStart = validate(
	Joi.object({
		place_id: Joi.string().trim().min(10).max(300).pattern(/^[A-Za-z0-9_-]+$/).required(),
		session: session.optional(),
		keyword: Joi.string().trim().min(2).max(80).required(),
	}),
	'body',
	['place_id', 'session', 'keyword'],
);

export const validateAuditId = catchAsync(async (req, res, next) => {
	if (!/^[0-9a-fA-F]{24}$/.test(String(req.params.auditId ?? ''))) return responseWrapper(res, '', 'auditId must be a valid id', httpStatus.BAD_REQUEST);
	next();
});
