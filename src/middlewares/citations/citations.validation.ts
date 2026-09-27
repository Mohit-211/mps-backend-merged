import Joi from 'joi';
import httpStatus from 'http-status';
import { CITATION_COUNTRIES, CITATION_STATUSES, DIRECTORY_TYPES } from '../../citations/constants';
import { catchAsync, pick, responseWrapper } from '../../utils';

// Citations (Phase 16): request validation. Validated input goes on res.locals.citationInput.

const objectId = Joi.string().hex().length(24);
const page = Joi.number().integer().min(1);
const limit = Joi.number().integer().min(1).max(100);
const regionCode = Joi.string().trim().uppercase().pattern(/^[A-Z]{2}$/);
const nullableText = (max: number) => Joi.string().trim().max(max).allow('', null);

const validate = (schema: Joi.ObjectSchema, source: 'body' | 'query', keys: string[]) =>
	catchAsync(async (req, res, next) => {
		const { value, error } = schema.validate(pick(source === 'body' ? req.body ?? {} : req.query, keys), { convert: true });
		if (error) return responseWrapper(res, '', error.message, httpStatus.BAD_REQUEST);
		res.locals.citationInput = value;
		next();
	});

/** Checks the named route params are ObjectIds (else 400). */
export const validateIds = (...names: string[]) =>
	catchAsync(async (req, res, next) => {
		const bad = names.find((n) => !/^[0-9a-fA-F]{24}$/.test(String(req.params[n] ?? '')));
		if (bad) return responseWrapper(res, '', `${bad} must be a valid id`, httpStatus.BAD_REQUEST);
		next();
	});

const directoryFields = {
	name: Joi.string().trim().min(1).max(120),
	url: Joi.string().trim().uri({ scheme: ['http', 'https'] }).max(300),
	type: Joi.string().valid(...DIRECTORY_TYPES),
	category_ids: Joi.array().items(objectId).max(50),
	countries: Joi.array().items(Joi.string().valid(...CITATION_COUNTRIES)).min(1).max(2),
	regions: Joi.array().items(regionCode).max(70),
	authority: Joi.number().integer().min(0).max(100).allow(null),
	notes: nullableText(2000),
	is_active: Joi.boolean(),
};
const directoryKeys = Object.keys(directoryFields);

export const validateDirectoryCreate = validate(
	Joi.object({ ...directoryFields, name: directoryFields.name.required(), url: directoryFields.url.required(), type: directoryFields.type.required(), countries: directoryFields.countries.required() }),
	'body',
	directoryKeys,
);
export const validateDirectoryUpdate = validate(Joi.object(directoryFields).min(1), 'body', directoryKeys);

export const validateDirectoryList = validate(
	Joi.object({
		q: Joi.string().trim().max(100).allow(''),
		type: Joi.string().valid(...DIRECTORY_TYPES),
		country: Joi.string().valid(...CITATION_COUNTRIES),
		category_id: objectId,
		active: Joi.boolean(),
		page,
		limit,
	}),
	'query',
	['q', 'type', 'country', 'category_id', 'active', 'page', 'limit'],
);

export const validateImportQuery = validate(Joi.object({ dry_run: Joi.boolean().default(false) }), 'query', ['dry_run']);

const categoryFields = {
	name: Joi.string().trim().min(1).max(80),
	slug: Joi.string().trim().lowercase().pattern(/^[a-z0-9-]{1,60}$/),
	business_category_ids: Joi.array().items(objectId).max(500),
	is_active: Joi.boolean(),
};
export const validateCategoryCreate = validate(Joi.object({ ...categoryFields, name: categoryFields.name.required() }), 'body', Object.keys(categoryFields));
export const validateCategoryUpdate = validate(Joi.object(categoryFields).min(1), 'body', Object.keys(categoryFields));

export const validateBusinessCategorySearch = validate(Joi.object({ q: Joi.string().trim().max(100).allow('') }), 'query', ['q']);

// ---- per-location lists, entries, queues (Phase 16) ----

export const validateSuggestQuery = validate(Joi.object({ dry_run: Joi.boolean().default(false) }), 'query', ['dry_run']);

export const validateAddEntries = validate(Joi.object({ directory_ids: Joi.array().items(objectId).min(1).max(200).required() }), 'body', ['directory_ids']);

const napFound = Joi.object({
	name: nullableText(200),
	address: nullableText(300),
	phone: nullableText(40),
	website: nullableText(300),
});

export const validateEntryUpdate = validate(
	Joi.object({
		status: Joi.string().valid(...CITATION_STATUSES),
		listing_url: Joi.string().trim().uri({ scheme: ['http', 'https'] }).max(500).allow('', null),
		nap_found: napFound,
		notes: nullableText(2000),
		checked: Joi.boolean(),
		confirm: Joi.boolean(),
		note: nullableText(500),
	}).or('status', 'listing_url', 'nap_found', 'notes', 'checked'),
	'body',
	['status', 'listing_url', 'nap_found', 'notes', 'checked', 'confirm', 'note'],
);

export const validateBulkUpdate = validate(
	Joi.object({
		entry_ids: Joi.array().items(objectId).min(1).max(200).required(),
		status: Joi.string().valid(...CITATION_STATUSES).required(),
		note: nullableText(500),
	}),
	'body',
	['entry_ids', 'status', 'note'],
);

export const validateEntryNote = validate(Joi.object({ note: nullableText(500) }), 'body', ['note']);

const queueFilters = {
	organization_id: objectId,
	client_id: objectId,
	status: Joi.string().valid(...CITATION_STATUSES),
	directory_id: objectId,
	type: Joi.string().valid(...DIRECTORY_TYPES),
	page,
	limit,
};
const queueKeys = Object.keys(queueFilters);
export const validateQueue = validate(Joi.object(queueFilters), 'query', queueKeys);
export const validateQueueDays = validate(Joi.object({ ...queueFilters, days: Joi.number().integer().min(1).max(730) }), 'query', [...queueKeys, 'days']);

export const validateHistoryQuery = validate(Joi.object({ page, limit }), 'query', ['page', 'limit']);

// ---- customer (read-only) ----

export const validateCustomerList = validate(Joi.object({ status: Joi.string().valid(...CITATION_STATUSES) }), 'query', ['status']);
export const validateCustomerChanges = validate(Joi.object({ page, limit }), 'query', ['page', 'limit']);
