import Joi from 'joi';
import httpStatus from 'http-status';
import { CLIENT_STATUSES } from '../../services/clients/client.service';
import { catchAsync, pick, responseWrapper } from '../../utils';

// Agency clients (Phase 8).

const fields = {
	name: Joi.string().trim().min(1).max(150),
	website: Joi.string().trim().uri({ scheme: ['http', 'https'] }).max(300).allow(null),
	contact_email: Joi.string().trim().email({ tlds: { allow: false } }).max(200).allow(null),
	status: Joi.string().valid(...CLIENT_STATUSES),
};

export const validateClientCreate = catchAsync(async (req, res, next) => {
	const { value, error } = Joi.object({ ...fields, name: fields.name.required() }).validate(pick(req.body, ['name', 'website', 'contact_email']));
	if (error) return responseWrapper(res, '', error.message, httpStatus.BAD_REQUEST);
	res.locals.clientInput = value;
	next();
});

export const validateClientUpdate = catchAsync(async (req, res, next) => {
	const { value, error } = Joi.object(fields).min(1).validate(pick(req.body, ['name', 'website', 'contact_email', 'status']));
	if (error) return responseWrapper(res, '', error.message, httpStatus.BAD_REQUEST);
	res.locals.clientInput = value;
	next();
});

export const validateClientListQuery = catchAsync(async (req, res, next) => {
	const { value, error } = Joi.object({
		search: Joi.string().trim().max(100).allow(''),
		status: Joi.string().valid(...CLIENT_STATUSES),
		page: Joi.number().integer().min(1),
		limit: Joi.number().integer().min(1).max(100),
	}).validate(pick(req.query, ['search', 'status', 'page', 'limit']));
	if (error) return responseWrapper(res, '', error.message, httpStatus.BAD_REQUEST);
	res.locals.clientQuery = value;
	next();
});

export const validateAssign = catchAsync(async (req, res, next) => {
	const { value, error } = Joi.object({ location_id: Joi.string().hex().length(24).required() }).validate(pick(req.body, ['location_id']));
	if (error) return responseWrapper(res, '', error.message, httpStatus.BAD_REQUEST);
	res.locals.assignLocationId = value.location_id;
	next();
});
