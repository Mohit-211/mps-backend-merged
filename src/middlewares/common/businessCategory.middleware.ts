import slugify from 'slugify';
import httpStatus from 'http-status';

import { responseWrapper, ApiError, catchAsync, isValidMongoObjectId } from '../../utils';

export const validCreateBusinessCategoryBody = catchAsync(async (req, res, next) => {
	try {
		const { name } = req.body;

		if (!name) {
			return responseWrapper(
				res,
				'',
				'Please Provide Required Fields: name',
				httpStatus.BAD_REQUEST,
			);
		};
        req.body.slug = slugify(name, { lower: true });
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

export const validUpdateBusinessCategoryBody = catchAsync(async (req, res, next) => {
	try {
		const { name } = req.body;
		const { businessCategoryId } = req.params;
		if(!isValidMongoObjectId(businessCategoryId)){
			return responseWrapper(
				res,
				'',
				'Invalid businessCategoryId',
				httpStatus.BAD_REQUEST,
			);
		}

		if (!name) {
			return responseWrapper(
				res,
				'',
				'Please Provide Required Fields: name',
				httpStatus.BAD_REQUEST,
			);
		};
        req.body.slug = slugify(name, { lower: true });
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