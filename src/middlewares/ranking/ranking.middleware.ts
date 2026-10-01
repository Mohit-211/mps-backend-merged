import httpStatus from 'http-status';
import Joi from 'joi';
import { GRID_SIZES, MAX_RADIUS_KM, MAX_SPACING_KM, MIN_RADIUS_KM, MIN_SPACING_KM } from '../../ranking/points';
import { findLocationForUser } from '../../services/org/access';
import { catchAsync, isValidMongoObjectId, pick, responseWrapper } from '../../utils';

// Ranking endpoints (CLAUDE.md §9.4). Every route runs verifyAuthJWTToken, then loadOwnedLocation.
// The loaded location and validated input go on res.locals (not req.body, which the client controls).

/**
 * 400 for a malformed id; 404 unless the location is active and the caller is an active member of its
 * organization (Phase 8; a client_user only for its clients' locations). Writes (anything but GET) need
 * owner/member: a client_user gets 403 read_only.
 */
export const loadOwnedLocation = catchAsync(async (req, res, next) => {
	const { locationId } = req.params;
	if (!isValidMongoObjectId(locationId)) {
		return responseWrapper(res, '', 'Invalid locationId', httpStatus.BAD_REQUEST);
	}
	const user = req.body?.user as { _id?: unknown } | undefined;
	if (!user?._id) return responseWrapper(res, '', 'Unauthorized : please authenticate.', httpStatus.UNAUTHORIZED);
	const access = await findLocationForUser(String(user._id), locationId, { write: req.method !== 'GET' && req.method !== 'HEAD' });
	if (!access) return responseWrapper(res, '', 'Location not found', httpStatus.NOT_FOUND);
	res.locals.location = access.location;
	res.locals.membership = access.membership;
	res.locals.userId = String(user._id);
	next();
});

const trackingUpdateSchema = Joi.object({
	keywords: Joi.array().items(Joi.string().max(200)).max(100),
	competitors: Joi.array().items(Joi.string().max(300)).max(20),
	// Phase 17: the radius (center to edge) or the spacing; the service derives the other and checks both.
	grid: Joi.object({
		size: Joi.number().valid(...GRID_SIZES).required(),
		radius_km: Joi.number().min(MIN_RADIUS_KM).max(MAX_RADIUS_KM),
		spacing_km: Joi.number().min(MIN_SPACING_KM).max(MAX_SPACING_KM),
	}).xor('radius_km', 'spacing_km'),
	frequency: Joi.string().valid('auto_monthly', 'manual_only'),
}).min(1);

const TRACKING_FIELDS = ['keywords', 'competitors', 'grid', 'frequency'];

export const validateTrackingUpdate = catchAsync(async (req, res, next) => {
	if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'next_run_at')) {
		return responseWrapper(
			res,
			'',
			'next_run_at is no longer supported: refresh is monthly (frequency "auto_monthly") or on demand ("manual_only").',
			httpStatus.BAD_REQUEST,
		);
	}
	const { value, error } = trackingUpdateSchema.validate(pick(req.body, TRACKING_FIELDS), { abortEarly: true });
	if (error) {
		const message = error.details[0]?.type === 'object.min' ? 'Provide at least one tracking field to update' : error.message;
		const data = error.details[0]?.path[0] === 'grid' ? { reason: 'invalid_grid' } : '';
		return responseWrapper(res, data, message, httpStatus.BAD_REQUEST);
	}
	res.locals.trackingUpdate = value;
	next();
});

// Phase 17: what a grid setting would cost before saving it (no Google calls).
const estimateQuerySchema = Joi.object({
	size: Joi.number().valid(...GRID_SIZES),
	radius_km: Joi.number().min(MIN_RADIUS_KM).max(MAX_RADIUS_KM),
	spacing_km: Joi.number().min(MIN_SPACING_KM).max(MAX_SPACING_KM),
	keywords: Joi.number().integer().min(1).max(100),
}).oxor('radius_km', 'spacing_km');

export const validateEstimateQuery = catchAsync(async (req, res, next) => {
	const { value, error } = estimateQuerySchema.validate(pick(req.query, ['size', 'radius_km', 'spacing_km', 'keywords']));
	if (error) return responseWrapper(res, { reason: 'invalid_grid' }, error.message, httpStatus.BAD_REQUEST);
	res.locals.estimateQuery = value;
	next();
});

// Phase 17: keyword groups (POST needs both fields, PATCH at least one).
const groupFields = {
	name: Joi.string().trim().min(1).max(60),
	keywords: Joi.array().items(Joi.string().max(200)).min(1).max(100),
};
const groupCreateSchema = Joi.object({ name: groupFields.name.required(), keywords: groupFields.keywords.required() });
const groupUpdateSchema = Joi.object(groupFields).min(1);

export const validateGroupBody = catchAsync(async (req, res, next) => {
	const schema = req.method === 'POST' ? groupCreateSchema : groupUpdateSchema;
	const { value, error } = schema.validate(pick(req.body, ['name', 'keywords']));
	if (error) return responseWrapper(res, '', error.message, httpStatus.BAD_REQUEST);
	res.locals.groupInput = value;
	next();
});

// Phase 17: one keyword's history across runs.
const historyQuerySchema = Joi.object({
	keyword: Joi.string().trim().min(1).max(200).required(),
	limit: Joi.number().integer().min(1).max(24).default(12),
});

export const validateHistoryQuery = catchAsync(async (req, res, next) => {
	const { value, error } = historyQuerySchema.validate(pick(req.query, ['keyword', 'limit']));
	if (error) return responseWrapper(res, '', error.message, httpStatus.BAD_REQUEST);
	res.locals.historyQuery = value;
	next();
});

const reportQuerySchema = Joi.object({
	runId: Joi.string().hex().length(24),
	keyword: Joi.string().trim().min(1).max(80),
	resolveNames: Joi.boolean(),
	// Phase 12.5 (map-ranking): which tracker point's list; 'all' returns the five side by side.
	point: Joi.string().trim().valid('C', 'N', 'S', 'E', 'W', 'c', 'n', 's', 'e', 'w', 'all'),
	// Phase 17: a keyword group id (rank-tracker and grid).
	group: Joi.string().hex().length(24),
});

export const validateReportQuery = catchAsync(async (req, res, next) => {
	const { value, error } = reportQuerySchema.validate(pick(req.query, ['runId', 'keyword', 'resolveNames', 'point', 'group']));
	if (error) return responseWrapper(res, '', error.message, httpStatus.BAD_REQUEST);
	res.locals.reportQuery = value;
	next();
});
