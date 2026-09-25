import httpStatus from 'http-status';

import { responseWrapper, ApiError, catchAsync } from '../../utils';

export const validCreateFaqBody = catchAsync(async (req, res, next) => {
	try {
		const { question, answer } = req.body;

		if (!question || !answer) {
			return responseWrapper(
				res,
				'',
				'Please Provide Required Fields: question, answer',
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