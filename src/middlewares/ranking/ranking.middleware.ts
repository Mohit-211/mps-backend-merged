import httpStatus from 'http-status';
import Joi from 'joi';
import { Location } from '../../models/location.model';
import { catchAsync, isValidMongoObjectId, pick, responseWrapper } from '../../utils';

// Ranking endpoints (CLAUDE.md §9.4). Every route runs verifyAuthJWTToken, then loadOwnedLocation.
// The loaded location and validated input go on res.locals (not req.body, which the client controls).

/** 400 for a malformed id; 404 unless the location exists, is active and was created by this user. */
export const loadOwnedLocation = catchAsync(async (req, res, next) => {
	const { locationId } = req.params;
	if (!isValidMongoObjectId(locationId)) {
		return responseWrapper(res, '', 'Invalid locationId', httpStatus.BAD_REQUEST);
	}
	const user = req.body?.user as { _id?: unknown } | undefined;
	if (!user?._id) return responseWrapper(res, '', 'Unauthorized : please authenticate.', httpStatus.UNAUTHORIZED);
	const location = await Location.findOne({ _id: locationId, created_by: user._id, is_active: true });
	if (!location) return responseWrapper(res, '', 'Location not found', httpStatus.NOT_FOUND);
	res.locals.location = location;
	res.locals.userId = String(user._id);
	next();
});

const trackingUpdateSchema = Joi.object({
	keywords: Joi.array().items(Joi.string().max(200)).max(100),
	competitors: Joi.array().items(Joi.string().max(300)).max(20),
	grid: Joi.object({
		size: Joi.number().valid(3, 5, 7).required(),
		spacing_km: Joi.number().min(0.25).max(5).required(),
	}),
	frequency: Joi.string().valid('weekly', 'monthly', 'manual'),
	next_run_at: Joi.date().iso().allow(null),
}).min(1);

const TRACKING_FIELDS = ['keywords', 'competitors', 'grid', 'frequency', 'next_run_at'];

export const validateTrackingUpdate = catchAsync(async (req, res, next) => {
	const { value, error } = trackingUpdateSchema.validate(pick(req.body, TRACKING_FIELDS), { abortEarly: true });
	if (error) {
		const message = error.details[0]?.type === 'object.min' ? 'Provide at least one tracking field to update' : error.message;
		return responseWrapper(res, '', message, httpStatus.BAD_REQUEST);
	}
	res.locals.trackingUpdate = value;
	next();
});

const reportQuerySchema = Joi.object({
	runId: Joi.string().hex().length(24),
	keyword: Joi.string().trim().min(1).max(80),
	resolveNames: Joi.boolean(),
});

export const validateReportQuery = catchAsync(async (req, res, next) => {
	const { value, error } = reportQuerySchema.validate(pick(req.query, ['runId', 'keyword', 'resolveNames']));
	if (error) return responseWrapper(res, '', error.message, httpStatus.BAD_REQUEST);
	res.locals.reportQuery = value;
	next();
});
