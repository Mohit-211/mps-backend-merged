import Joi from 'joi';
import httpStatus from 'http-status';
import { ENTITLEMENT_STATES } from '../../billing/constants';
import { TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES } from '../../models';
import { catchAsync, pick, responseWrapper } from '../../utils';

// Admin panel + support validation (Phase 13b). The validated value is on res.locals.input.

const validate = (schema: Joi.Schema, source: 'body' | 'query', keys: string[]) =>
	catchAsync(async (req, res, next) => {
		const { value, error } = schema.validate(pick(source === 'body' ? req.body ?? {} : req.query, keys));
		if (error) return responseWrapper(res, { reason: 'invalid_input' }, error.message, httpStatus.BAD_REQUEST);
		res.locals.input = value;
		next();
	});

const objectId = Joi.string().hex().length(24);
const page = { page: Joi.number().integer().min(1).default(1), limit: Joi.number().integer().min(1).max(100).default(20) };
const reason = Joi.string().trim().min(3).max(500);

export const validateUserList = validate(Joi.object({ ...page, q: Joi.string().trim().max(100), status: Joi.string().valid('active', 'disabled', 'unverified') }), 'query', ['page', 'limit', 'q', 'status']);
export const validateReason = validate(Joi.object({ reason: reason.required() }), 'body', ['reason']);
export const validateNote = validate(Joi.object({ note: Joi.string().trim().max(500).allow('', null) }), 'body', ['note']);
export const validateOrgList = validate(
	Joi.object({
		...page,
		q: Joi.string().trim().max(100),
		type: Joi.string().valid('business', 'agency'),
		state: Joi.string().valid(...ENTITLEMENT_STATES),
		plan: Joi.string().valid('standard', 'custom'),
		trial_ending_days: Joi.number().integer().min(1).max(90),
	}),
	'query',
	['page', 'limit', 'q', 'type', 'state', 'plan', 'trial_ending_days'],
);
export const validateTrial = validate(Joi.object({ trial_ends_at: Joi.date().iso().required() }), 'body', ['trial_ends_at']);
export const validateLimits = validate(
	Joi.object({ max_locations: Joi.number().integer().min(1).max(10000).allow(null), extra_users: Joi.number().integer().min(0).max(1000) }),
	'body',
	['max_locations', 'extra_users'],
);

// Support tickets
export const validateTicketCreate = validate(
	Joi.object({
		subject: Joi.string().trim().min(3).max(200).required(),
		category: Joi.string().valid(...TICKET_CATEGORIES),
		message: Joi.string().trim().min(1).max(10000).required(),
		location_id: objectId.allow(null),
	}),
	'body',
	['subject', 'category', 'message', 'location_id'],
);
export const validateTicketList = validate(Joi.object({ ...page, status: Joi.string().valid(...TICKET_STATUSES) }), 'query', ['page', 'limit', 'status']);
export const validateMessage = validate(Joi.object({ message: Joi.string().trim().min(1).max(10000).required() }), 'body', ['message']);
export const validateAdminTicketList = validate(
	Joi.object({ ...page, status: Joi.string().valid(...TICKET_STATUSES), organization_id: objectId, assigned_to: objectId, unassigned: Joi.boolean(), q: Joi.string().trim().max(100) }),
	'query',
	['page', 'limit', 'status', 'organization_id', 'assigned_to', 'unassigned', 'q'],
);
export const validateAdminMessage = validate(Joi.object({ message: Joi.string().trim().min(1).max(10000).required(), internal: Joi.boolean().default(false) }), 'body', ['message', 'internal']);
export const validateTicketUpdate = validate(
	Joi.object({ status: Joi.string().valid(...TICKET_STATUSES), priority: Joi.string().valid(...TICKET_PRIORITIES), assigned_to: objectId.allow(null) }).min(1),
	'body',
	['status', 'priority', 'assigned_to'],
);
