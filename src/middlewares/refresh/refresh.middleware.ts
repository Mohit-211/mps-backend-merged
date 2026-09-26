import httpStatus from 'http-status';
import { invalidRefreshTypes } from '../../services/refresh/refresh.service';
import { catchAsync, responseWrapper } from '../../utils';

/** POST /locations/:id/refresh { types?: ["rankings","gbp"] }. */
export const validateRefresh = catchAsync(async (req, res, next) => {
	const types = req.body?.types;
	const error = invalidRefreshTypes(types);
	if (error) return responseWrapper(res, '', error.message, httpStatus.BAD_REQUEST);
	res.locals.refreshTypes = types;
	next();
});
