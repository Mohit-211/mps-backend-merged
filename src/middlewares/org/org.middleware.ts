import httpStatus from 'http-status';
import Joi from 'joi';
import { agencyOnly, canWrite, ownerOnly, readOnly } from '../../services/org/access';
import { OrgContext, resolveOrgContext } from '../../services/org/context';
import { catchAsync, isValidMongoObjectId, pick, responseWrapper } from '../../utils';

// Organization context (Phase 8). Runs after verifyAuthJWTToken; sets res.locals.org.

export const ORG_HEADER = 'x-organization-id';

export const loadOrgContext = catchAsync(async (req, res, next) => {
	const user = req.body?.user as { _id?: unknown } | undefined;
	if (!user?._id) return responseWrapper(res, '', 'Unauthorized : please authenticate.', httpStatus.UNAUTHORIZED);
	const header = req.headers[ORG_HEADER];
	const requested = typeof header === 'string' && header.length > 0 ? header : null;
	if (requested && !isValidMongoObjectId(requested)) return responseWrapper(res, '', 'Invalid X-Organization-Id', httpStatus.BAD_REQUEST);
	res.locals.org = await resolveOrgContext(String(user._id), requested);
	res.locals.userId = String(user._id);
	next();
});

const ctx = (res: { locals: Record<string, unknown> }): OrgContext => res.locals.org as OrgContext;

/** owner / member only (client_user is read-only). */
export const requireWrite = catchAsync(async (req, res, next) => {
	if (!canWrite(ctx(res))) throw readOnly();
	next();
});

export const requireOwner = catchAsync(async (req, res, next) => {
	if (ctx(res).membership.role !== 'owner') throw ownerOnly();
	next();
});

export const requireAgency = catchAsync(async (req, res, next) => {
	if (ctx(res).organization.type !== 'agency') throw agencyOnly();
	next();
});

/** PATCH /organization { name?, country? } (owner). */
export const validateOrgUpdate = catchAsync(async (req, res, next) => {
	const { value, error } = Joi.object({
		name: Joi.string().trim().min(1).max(150),
		country: Joi.string().valid('US', 'CA'),
	})
		.min(1)
		.validate(pick(req.body, ['name', 'country']));
	if (error) return responseWrapper(res, '', error.message, httpStatus.BAD_REQUEST);
	res.locals.orgUpdate = value;
	next();
});
