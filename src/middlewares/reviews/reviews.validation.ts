import httpStatus from 'http-status';
import Joi from 'joi';
import config from '../../configs/config';
import { REVIEW_REPLY_STATES, REVIEW_REPORT_STATUSES } from '../../models';
import { catchAsync, pick, responseWrapper } from '../../utils';

// Review management input (Phase 18). Validated values go on res.locals.reviewInput.

const objectId = Joi.string().hex().length(24);
const ids = (max: number) => Joi.array().items(objectId).min(1).max(max).unique().required();

const run = (schema: Joi.ObjectSchema, source: 'query' | 'body', keys: string[]) =>
	catchAsync(async (req, res, next) => {
		const { value, error } = schema.validate(pick(source === 'query' ? req.query : req.body, keys));
		if (error) return responseWrapper(res, { reason: 'invalid_input' }, error.message, httpStatus.BAD_REQUEST);
		res.locals.reviewInput = value;
		next();
	});

export const validateReviewList = run(
	Joi.object({
		rating: Joi.alternatives(Joi.number().integer().min(1).max(5), Joi.string().pattern(/^[1-5](,[1-5])*$/)),
		replied: Joi.boolean(),
		reply_state: Joi.string().valid(...REVIEW_REPLY_STATES),
		flagged: Joi.string().valid('any', 'suspicious', 'attention', 'none'),
		has_draft: Joi.boolean(),
		search: Joi.string().trim().min(1).max(100),
		sort: Joi.string().valid('newest', 'oldest', 'rating_asc', 'rating_desc'),
		page: Joi.number().integer().min(1).default(1),
		limit: Joi.number().integer().min(1).max(100).default(25),
	}),
	'query',
	['rating', 'replied', 'reply_state', 'flagged', 'has_draft', 'search', 'sort', 'page', 'limit'],
);

export const validateDrafts = run(
	Joi.object({ review_ids: ids(config.ai.maxReviewsPerRequest), regenerate: Joi.boolean().default(false) }),
	'body',
	['review_ids', 'regenerate'],
);

export const validateAnalyze = validateDrafts;

export const validateSend = run(Joi.object({ review_ids: ids(50) }), 'body', ['review_ids']);

export const validateDraftText = run(Joi.object({ text: Joi.string().trim().min(1).max(4000).required() }), 'body', ['text']);

export const validateRegenerate = run(Joi.object({ regenerate: Joi.boolean().default(false) }), 'body', ['regenerate']);

export const validateReportStatus = run(Joi.object({ status: Joi.string().valid(...REVIEW_REPORT_STATUSES).required() }), 'body', ['status']);
