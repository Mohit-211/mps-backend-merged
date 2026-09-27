import Joi from 'joi';
import httpStatus from 'http-status';
import { MAX_SCHEDULE_RECIPIENTS, REPORT_RANGES, REPORT_STATUSES, REPORT_TYPES, SCHEDULE_SCOPES } from '../../models';
import { catchAsync, pick, responseWrapper } from '../../utils';

// Reports center (Phase 12): request validation. Section names are checked per type in the service.

const objectId = Joi.string().hex().length(24);
const email = Joi.string().trim().lowercase().email({ tlds: { allow: false } }).max(200);
const recipients = Joi.array().items(email).min(1).max(MAX_SCHEDULE_RECIPIENTS);
const sections = Joi.array().items(Joi.string().max(40)).max(10);

const validate = (schema: Joi.Schema, source: 'body' | 'query', keys: string[], local: string) =>
	catchAsync(async (req, res, next) => {
		const { value, error } = schema.validate(pick(source === 'body' ? req.body ?? {} : req.query, keys));
		if (error) return responseWrapper(res, '', error.message, httpStatus.BAD_REQUEST);
		res.locals[local] = value;
		next();
	});

export const validateReportCreate = validate(
	Joi.object({
		location_id: objectId.required(),
		type: Joi.string().valid(...REPORT_TYPES).required(),
		sections,
		run_id: objectId.allow(null),
		range: Joi.string().valid(...REPORT_RANGES),
	}),
	'body',
	['location_id', 'type', 'sections', 'run_id', 'range'],
	'reportInput',
);

export const validateReportList = validate(
	Joi.object({
		location_id: objectId,
		client_id: objectId,
		type: Joi.string().valid(...REPORT_TYPES),
		status: Joi.string().valid(...REPORT_STATUSES, 'archived'),
		page: Joi.number().integer().min(1),
		limit: Joi.number().integer().min(1).max(100),
	}),
	'query',
	['location_id', 'client_id', 'type', 'status', 'page', 'limit'],
	'reportQuery',
);

export const validateReportEmail = validate(
	Joi.object({ recipients: recipients.required(), message: Joi.string().trim().max(1000).allow('', null) }),
	'body',
	['recipients', 'message'],
	'emailInput',
);

export const validateShareCreate = validate(
	Joi.object({ expires_in_days: Joi.number().integer().min(1).max(365).allow(null) }),
	'body',
	['expires_in_days'],
	'shareInput',
);

const scheduleFields = {
	type: Joi.string().valid(...REPORT_TYPES),
	sections,
	range: Joi.string().valid(...REPORT_RANGES),
	recipients,
};

export const validateScheduleCreate = validate(
	Joi.object({
		...scheduleFields,
		scope: Joi.string().valid(...SCHEDULE_SCOPES).required(),
		location_id: objectId.when('scope', { is: 'location', then: Joi.required(), otherwise: Joi.forbidden() }),
		client_id: objectId.when('scope', { is: 'client', then: Joi.required(), otherwise: Joi.forbidden() }),
		type: scheduleFields.type.required(),
		recipients: recipients.required(),
	}),
	'body',
	['scope', 'location_id', 'client_id', 'type', 'sections', 'range', 'recipients'],
	'scheduleInput',
);

export const validateScheduleUpdate = validate(
	Joi.object({ ...scheduleFields, status: Joi.string().valid('active', 'paused') }).min(1),
	'body',
	['type', 'sections', 'range', 'recipients', 'status'],
	'scheduleInput',
);

export const validateScheduleList = validate(
	Joi.object({ location_id: objectId, client_id: objectId, status: Joi.string().valid('active', 'paused') }),
	'query',
	['location_id', 'client_id', 'status'],
	'scheduleQuery',
);

const color = Joi.string().pattern(/^#[0-9a-fA-F]{6}$/).lowercase().allow(null);
const text = (max: number) => Joi.string().trim().max(max).allow('', null);

export const validateBrandingUpdate = validate(
	Joi.object({
		agency_name: text(150),
		primary_color: color,
		secondary_color: color,
		footer_text: text(300),
		contact_text: text(300),
		hide_mypageseo: Joi.boolean(),
		email_sender_name: text(60),
		email_reply_to: email.allow(null),
	}).min(1),
	'body',
	['agency_name', 'primary_color', 'secondary_color', 'footer_text', 'contact_text', 'hide_mypageseo', 'email_sender_name', 'email_reply_to'],
	'brandingInput',
);

/** The base64 of a 512 KB image is about 700 KB; anything much larger is refused before decoding. */
export const validateLogoUpload = validate(Joi.object({ data: Joi.string().max(760_000).required() }), 'body', ['data'], 'logoInput');
