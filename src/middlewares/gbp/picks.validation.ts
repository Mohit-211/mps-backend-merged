import Joi from 'joi';
import httpStatus from 'http-status';
import { catchAsync, pick, responseWrapper } from '../../utils';

// Google connect picks (2026-10-01). Validated input goes on res.locals.

const gbpLocationId = Joi.string().pattern(/^locations\/[A-Za-z0-9_-]{1,64}$/);

/** PUT /gbp/connections/:googleSub/picks { gbp_location_ids: ["locations/…"] } (an empty list clears the unbound picks). */
export const validateSavePicks = catchAsync(async (req, res, next) => {
	const { value, error } = Joi.object({ gbp_location_ids: Joi.array().items(gbpLocationId).max(500).required() }).validate(pick(req.body ?? {}, ['gbp_location_ids']));
	if (error) return responseWrapper(res, '', error.message, httpStatus.BAD_REQUEST);
	res.locals.gbpLocationIds = value.gbp_location_ids;
	next();
});

/** POST /gbp/picks/:pickId/bind { client_id? } */
export const validateBindPick = catchAsync(async (req, res, next) => {
	const { value, error } = Joi.object({ client_id: Joi.string().hex().length(24) }).validate(pick(req.body ?? {}, ['client_id']));
	if (error) return responseWrapper(res, '', error.message, httpStatus.BAD_REQUEST);
	res.locals.bindInput = value;
	next();
});
