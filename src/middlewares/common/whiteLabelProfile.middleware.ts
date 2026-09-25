import httpStatus from 'http-status';

import { responseWrapper, ApiError, catchAsync } from '../../utils';
import { colors, colorsArr, reportsArr } from '../../configs/constantTypes';
import { Location, WhitelabelProfile } from '../../models';

export const validateNewWhiteLabelBody = catchAsync(async (req, res, next) => {
	try {
		let {name, header, footer, color } = req.body;
		if (!name || !header || !footer || !color ) {
			return responseWrapper(
				res,
				'',
				'Please Provide Required Fields: name, header, footer inside body',
				httpStatus.BAD_REQUEST,
			);
		};
		if(color && !colorsArr.includes(color)) {
			return responseWrapper(
				res,
				'',
				'Invalid color provided',
				httpStatus.BAD_REQUEST,
			);
		}else{
            color = colors.DEFAULT
        }

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

export const validateUpdateWhiteLabelBody = catchAsync(async (req, res, next) => {
	try {
		let {color, location_id, white_label_profile_id, user, external_reports_lists } = req.body;
        if(!white_label_profile_id){
            return responseWrapper(
				res,
				'',
				'Please provide : white_label_profile_id',
				httpStatus.BAD_REQUEST,
			);
        }

		if(color && !colorsArr.includes(color)) {
			return responseWrapper(
				res,
				'',
				'Invalid color provided',
				httpStatus.BAD_REQUEST,
			);
		}else{
            color = colors.DEFAULT
        }
		if(location_id){
			const locationDoc = await Location.findOne({_id: location_id, created_by: user._id, is_active: true});
			if(!locationDoc){
				return responseWrapper(
					res,
					'',
					'Location not found with this location_id.',
					httpStatus.BAD_REQUEST,
				);
			};
			req.body.locationDoc = locationDoc;
		}

        let reports_lists = {};

        reportsArr.forEach(elm =>{
            if(req.body[elm] === '1'){
                reports_lists[elm] = true;
            }else{
                reports_lists[elm] = false;
            }
        })

        req.body.external_reports_lists = reports_lists;
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

export const validateWLPReportParams = catchAsync(async (req, res, next) => {
	try {
		let { whiteLevelProfileId } = req.params;
        if(!whiteLevelProfileId){
            return responseWrapper(
				res,
				'',
				'Please provide : white_label_profile_id',
				httpStatus.BAD_REQUEST,
			);
        }

		const whiteLevelProfileDoc = await WhitelabelProfile.findOne({_id: whiteLevelProfileId, is_active: true});
		if(!whiteLevelProfileDoc){
			return responseWrapper(
				res,
				'',
				'Invalid white_label_profile_id',
				httpStatus.BAD_REQUEST,
			);
		}
		if(!whiteLevelProfileDoc.location_id){
			return responseWrapper(
				res,
				'',
				'No location bind with the selected white level profile Id',
				httpStatus.BAD_REQUEST,
			);
		}
		const locationDoc = await Location.findOne({_id: whiteLevelProfileDoc.location_id, is_active: true});
		if(!locationDoc){
			return responseWrapper(
				res,
				'',
				'A valid Location not found.',
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