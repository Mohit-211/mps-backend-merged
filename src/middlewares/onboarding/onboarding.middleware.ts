import Joi from 'joi';
import httpStatus from 'http-status';
import { findLocationForUser } from '../../services/org/access';
import { catchAsync, pick, responseWrapper } from '../../utils';

// Onboarding + manual Places search (Phase 7a). Validated input goes on res.locals, not req.body.

const selectProfileSchema = Joi.object({
	gbpAccountId: Joi.string().pattern(/^accounts\/[A-Za-z0-9_-]{1,64}$/).required(),
	gbpLocationId: Joi.string().pattern(/^locations\/[A-Za-z0-9_-]{1,64}$/).required(),
	location_id: Joi.string().hex().length(24),
	google_sub: Joi.string().trim().min(1).max(255),
	client_id: Joi.string().hex().length(24),
});

export const validateSelectProfile = catchAsync(async (req, res, next) => {
	const { value, error } = selectProfileSchema.validate(pick(req.body, ['gbpAccountId', 'gbpLocationId', 'location_id', 'google_sub', 'client_id']));
	if (error) return responseWrapper(res, '', error.message, httpStatus.BAD_REQUEST);
	res.locals.selectProfile = value;
	next();
});

export const validateComplete = catchAsync(async (req, res, next) => {
	const { value, error } = Joi.object({ location_id: Joi.string().hex().length(24).required() }).validate(pick(req.body, ['location_id']));
	if (error) return responseWrapper(res, '', error.message, httpStatus.BAD_REQUEST);
	res.locals.locationId = value.location_id;
	next();
});

/** POST /onboarding/skip { step: 'google' | 'reporting_brand' } (Phase 8). */
export const validateSkip = catchAsync(async (req, res, next) => {
	const { value, error } = Joi.object({ step: Joi.string().valid('google', 'reporting_brand').required() }).validate(pick(req.body, ['step']));
	if (error) return responseWrapper(res, '', error.message, httpStatus.BAD_REQUEST);
	res.locals.skipStep = value.step;
	next();
});

export const validateSuggestionsQuery = catchAsync(async (req, res, next) => {
	const { value, error } = Joi.object({ refresh: Joi.boolean() }).validate(pick(req.query, ['refresh']));
	if (error) return responseWrapper(res, '', error.message, httpStatus.BAD_REQUEST);
	res.locals.refresh = value.refresh === true;
	next();
});

/**
 * ?q= (2–100 chars) and optional ?locationId= (a competitor search for that location; the caller must be
 * owner/member of its organization, else 404) or, without it, ?country=US|CA (an add-location search in
 * the current organization; default the organization's country). Phase 8.
 */
export const validatePlacesSearch = catchAsync(async (req, res, next) => {
	const { value, error } = Joi.object({
		q: Joi.string().trim().min(2).max(100).required(),
		locationId: Joi.string().hex().length(24),
		country: Joi.string().valid('US', 'CA', 'us', 'ca'),
	}).validate(pick(req.query, ['q', 'locationId', 'country']));
	if (error) return responseWrapper(res, '', error.message, httpStatus.BAD_REQUEST);
	const user = req.body?.user as { _id?: unknown } | undefined;
	if (value.locationId) {
		const access = await findLocationForUser(String(user?._id), value.locationId, { write: true });
		if (!access) return responseWrapper(res, '', 'Location not found', httpStatus.NOT_FOUND);
		res.locals.location = access.location;
	} else {
		res.locals.location = null;
		res.locals.country = value.country ? String(value.country).toUpperCase() : null;
	}
	res.locals.userId = String(user?._id);
	res.locals.q = value.q;
	next();
});

/** PUT /locations/:locationId/center { query }: a city or ZIP / postal code, 2–100 characters. */
export const validateCenter = catchAsync(async (req, res, next) => {
	const { value, error } = Joi.object({ query: Joi.string().trim().min(2).max(100).required() }).validate(pick(req.body, ['query']));
	if (error) return responseWrapper(res, '', error.message, httpStatus.BAD_REQUEST);
	res.locals.centerQuery = value.query;
	next();
});

