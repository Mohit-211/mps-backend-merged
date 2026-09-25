import httpStatus from 'http-status';

import { responseWrapper, ApiError, catchAsync, isValidMongoObjectId } from '../../utils';
import { membershipTypeArr, userTypes } from '../../configs/constantTypes';
import { Location } from '../../models';

export const validFetchMonitorReviewReportBody = catchAsync(async (req, res, next) => {
	try {
		const { locationId } = req.params;
		if (!locationId ) {
			return responseWrapper(
				res,
				'',
				'Please Provide Required Fields: locationId inside params',
				httpStatus.BAD_REQUEST,
			);
		};
		if(!isValidMongoObjectId(locationId)) {
			return responseWrapper(
				res,
				'',
				'Invalid location_id provided',
				httpStatus.BAD_REQUEST,
			);
		};

		const locationDoc = await Location.findOne({_id: locationId, is_active: true});
		if(!locationDoc){
			return responseWrapper(
				res,
				'',
				'Location not found with this locationId.',
				httpStatus.BAD_REQUEST,
			);
		};
		req.body.locationDoc = locationDoc;

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
