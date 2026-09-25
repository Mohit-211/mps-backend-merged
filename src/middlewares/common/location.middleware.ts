import httpStatus from 'http-status';

import { responseWrapper, ApiError, catchAsync, isValidMongoObjectId } from '../../utils';
import { userTypes } from '../../configs/constantTypes';
import { Client } from '../../models';

export const validCreateLocationBody = catchAsync(async (req, res, next) => {
	try {
		const { name, address, country, state, city, zip_code, mobile, website_URL, business_category, client_id, user } = req.body;

		if (!name || !address || !country || !state || !city || !zip_code || !mobile || !website_URL || !business_category) {
			return responseWrapper(
				res,
				'',
				'Please Provide Required Fields: name, address, country, state, city, zip_code, mobile, website_URL, business_category',
				httpStatus.BAD_REQUEST,
			);
		};

        if(user.user_type === userTypes.agency){
			if(!isValidMongoObjectId(client_id)) {
				return responseWrapper(
					res,
					'',
					'Invalid cilient id provided',
					httpStatus.BAD_REQUEST,
				);
			}
            const clientDoc = await Client.findOne({created_by: user._id, _id: client_id, is_active: true});
            if(!clientDoc){
                return responseWrapper(
                    res,
                    '',
                    'No client found with this clinet id',
                    httpStatus.BAD_REQUEST,
                );
            };
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