import Joi from 'joi';
import httpStatus from 'http-status';
import { DASHBOARD_SORTS } from '../../services/dashboard/dashboard.service';
import { catchAsync, pick, responseWrapper } from '../../utils';

/** GET /dashboard?page=&limit=&sort=&order= (the agency portfolio table). */
export const validateDashboardQuery = catchAsync(async (req, res, next) => {
	const { value, error } = Joi.object({
		page: Joi.number().integer().min(1),
		limit: Joi.number().integer().min(1).max(100),
		sort: Joi.string().valid(...DASHBOARD_SORTS),
		order: Joi.string().valid('asc', 'desc'),
	}).validate(pick(req.query, ['page', 'limit', 'sort', 'order']));
	if (error) return responseWrapper(res, '', error.message, httpStatus.BAD_REQUEST);
	res.locals.dashboardQuery = value;
	next();
});
