import httpStatus from 'http-status';

import { responseWrapper, ApiError, catchAsync } from '../../utils';

export const validCreateSupportBody = catchAsync(async (req, res, next) => {
	try {
		const { name, email, subject } = req.body;

		if (!name || !email || !subject) {
			return responseWrapper(
				res,
				'',
				'Please Provide Required Fields: name, email, subject',
				httpStatus.BAD_REQUEST,
			);
		};
        next();
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
});