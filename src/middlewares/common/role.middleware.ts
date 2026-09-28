import httpStatus from 'http-status';

import { responseWrapper, ApiError, catchAsync } from '../../utils';
import { userTypes } from '../../configs/constantTypes';

export const isAgency= catchAsync(async (req, res, next) => {
	try {
		const { user } = req.body;
		if (
			user && user.user_type === userTypes.agency
		) {
			next();
		} else {
			return responseWrapper(
				res,
				'',
				'Only Agencies can access this',
				httpStatus.UNAUTHORIZED,
			);
		}
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
});
