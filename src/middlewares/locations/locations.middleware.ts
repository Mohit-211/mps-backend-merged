import Joi from 'joi';
import httpStatus from 'http-status';
import { LOCATION_STATUSES } from '../../services/locations/status';
import { LIST_SORTS } from '../../services/locations/locations.service';
import { catchAsync, pick, responseWrapper } from '../../utils';

// Locations (Phase 8). Validated input goes on res.locals.

const objectId = Joi.string().hex().length(24);

export const validateListQuery = catchAsync(async (req, res, next) => {
	const { value, error } = Joi.object({
		search: Joi.string().trim().max(100).allow(''),
		client_id: objectId,
		status: Joi.string().valid(...LOCATION_STATUSES),
		sort: Joi.string().valid(...LIST_SORTS),
		order: Joi.string().valid('asc', 'desc'),
		page: Joi.number().integer().min(1),
		limit: Joi.number().integer().min(1).max(100),
	}).validate(pick(req.query, ['search', 'client_id', 'status', 'sort', 'order', 'page', 'limit']));
	if (error) return responseWrapper(res, '', error.message, httpStatus.BAD_REQUEST);
	res.locals.listQuery = value;
	next();
});

/** POST /locations { place_id, client_id? }: a Places search result (no manual entry). */
export const validateAddLocation = catchAsync(async (req, res, next) => {
	const { value, error } = Joi.object({
		place_id: Joi.string().trim().min(10).max(300).pattern(/^[A-Za-z0-9_-]+$/).required(),
		client_id: objectId,
	}).validate(pick(req.body, ['place_id', 'client_id']));
	if (error) return responseWrapper(res, '', error.message, httpStatus.BAD_REQUEST);
	res.locals.addLocation = value;
	next();
});

/** PATCH /locations/:id { name?, timezone?, client_id? } (business data comes from GBP / Places). */
export const validateLocationUpdate = catchAsync(async (req, res, next) => {
	const { value, error } = Joi.object({
		name: Joi.string().trim().min(1).max(150),
		timezone: Joi.string()
			.trim()
			.max(64)
			.custom((tz, helpers) => {
				try {
					new Intl.DateTimeFormat('en-US', { timeZone: tz });
					return tz;
				} catch {
					return helpers.error('any.invalid');
				}
			})
			.allow(null),
		client_id: objectId.allow(null),
	})
		.min(1)
		.validate(pick(req.body, ['name', 'timezone', 'client_id']));
	if (error) return responseWrapper(res, '', error.message, httpStatus.BAD_REQUEST);
	res.locals.locationUpdate = value;
	next();
});
