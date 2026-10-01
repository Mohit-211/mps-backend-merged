import Joi from 'joi';
import httpStatus from 'http-status';
import { SESSION_TOKEN_PATTERN } from '../../clients/placesClient';
import { findLocationForUser } from '../../services/org/access';
import { catchAsync, pick, responseWrapper } from '../../utils';

// Onboarding + manual Places search (Phase 7a). Validated input goes on res.locals, not req.body.

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
// { query } (a text search) or, from the picker (2026-10-01), { place_id, session? }.
export const validateCenter = catchAsync(async (req, res, next) => {
	const { value, error } = Joi.object({
		query: Joi.string().trim().min(2).max(100),
		place_id: Joi.string().trim().pattern(/^[A-Za-z0-9_-]{10,255}$/),
		session: Joi.string().pattern(SESSION_TOKEN_PATTERN),
	})
		.xor('query', 'place_id')
		.with('session', 'place_id')
		.validate(pick(req.body, ['query', 'place_id', 'session']));
	if (error) return responseWrapper(res, '', error.message, httpStatus.BAD_REQUEST);
	res.locals.centerQuery = value.query ?? null;
	res.locals.centerPlace = value.place_id ? { place_id: value.place_id as string, session: (value.session as string | undefined) ?? undefined } : null;
	next();
});

// GET /places/autocomplete (2026-10-01): the setup-center picker. The country is the location's
// (?locationId=), else ?country=, else the organization's.
export const validateAutocomplete = catchAsync(async (req, res, next) => {
	const { value, error } = Joi.object({
		q: Joi.string().trim().min(1).max(100).required(),
		session: Joi.string().pattern(SESSION_TOKEN_PATTERN).required(),
		country: Joi.string().valid('US', 'CA', 'us', 'ca'),
		locationId: Joi.string().hex().length(24),
	}).validate(pick(req.query, ['q', 'session', 'country', 'locationId']));
	if (error) return responseWrapper(res, '', error.message, httpStatus.BAD_REQUEST);
	let country: string | null = value.country ? String(value.country).toUpperCase() : null;
	if (value.locationId) {
		const user = req.body?.user as { _id?: unknown } | undefined;
		const access = await findLocationForUser(String(user?._id), value.locationId, { write: true });
		if (!access) return responseWrapper(res, '', 'Location not found', httpStatus.NOT_FOUND);
		country = access.location.country ?? country;
	}
	res.locals.autocomplete = { q: value.q as string, session: value.session as string, country };
	next();
});

