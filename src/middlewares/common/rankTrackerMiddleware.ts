import httpStatus from 'http-status';

import { responseWrapper, ApiError, catchAsync, isValidMongoObjectId, validateTime12HourFormat, compareObjectIds } from '../../utils';
import { membershipTypeArr, userTypes } from '../../configs/constantTypes';
import { Location } from '../../models';

export const validCreateRankTrackerReportBody = catchAsync(async (req, res, next) => {
	try {
		const { location_id, scheduling, keywords, competitors, user } = req.body;

		if (!location_id || !scheduling || !keywords || !competitors) {
			return responseWrapper(
				res,
				'',
				'Please Provide Required Fields: location_id, scheduling, keywords, competitors',
				httpStatus.BAD_REQUEST,
			);
		};
		if (!isValidMongoObjectId(location_id)) {
			return responseWrapper(
				res,
				'',
				'Invalid location_id provided',
				httpStatus.BAD_REQUEST,
			);
		};

		const locationDoc = await Location.findOne({ _id: location_id, is_active: true });
		if (!locationDoc) {
			return responseWrapper(
				res,
				'',
				'Location not found with this location_id.',
				httpStatus.BAD_REQUEST,
			);
		};
		req.body.locationDoc = locationDoc;

		const { frequency, run_time, run_at, time_zone } = scheduling;
		if (!frequency || !run_time || !run_at || !time_zone) {
			return responseWrapper(
				res,
				'',
				'Please Provide Required Fields inside scheduling: frequency, run_time, run_at, time_zone.',
				httpStatus.BAD_REQUEST,
			);
		};
		if (!membershipTypeArr.includes(frequency)) {
			return responseWrapper(
				res,
				'',
				'Invalid frequency inside scheduling.',
				httpStatus.BAD_REQUEST,
			);
		};
		const { start_time, end_time } = run_time;
		if (!start_time || !end_time) {
			return responseWrapper(
				res,
				'',
				'Please Provide Required Fields inside scheduling.run_time: start_time, end_time.',
				httpStatus.BAD_REQUEST,
			);
		};
		if (!validateTime12HourFormat(start_time) || !validateTime12HourFormat(end_time)) {
			return responseWrapper(
				res,
				'',
				'Invalid start_time or end_time inside scheduling.run_time, valid format is HH:MM AM/PM',
				httpStatus.BAD_REQUEST,
			);
		};

		if (!Array.isArray(competitors) || competitors.length === 0 || competitors.find(elm => !elm.name || !elm.place_id || !elm.website || !elm.lat || !elm.lng)) {
			return responseWrapper(
				res,
				'',
				'Invalid competitors type : it need array of objects containing name, place_id, website, lat and lng.',
				httpStatus.BAD_REQUEST,
			);
		};
		if (!Array.isArray(keywords) || keywords.length === 0) {
			return responseWrapper(
				res,
				'',
				'Invalid keywords type : it need array of string',
				httpStatus.BAD_REQUEST,
			);
		};
		if (!compareObjectIds(user._id, locationDoc.created_by)) {
			return responseWrapper(
				res,
				'',
				'Provided location_id is not belongs to the user requested.',
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

export const validFetchRankTrackerReportBody = catchAsync(async (req, res, next) => {
	try {
		const { locationId } = req.params;
		if (!locationId) {
			return responseWrapper(
				res,
				'',
				'Please Provide Required Fields: locationId inside params',
				httpStatus.BAD_REQUEST,
			);
		};
		if (!isValidMongoObjectId(locationId)) {
			return responseWrapper(
				res,
				'',
				'Invalid location_id provided',
				httpStatus.BAD_REQUEST,
			);
		};

		const locationDoc = await Location.findOne({ _id: locationId, is_active: true });
		if (!locationDoc) {
			return responseWrapper(
				res,
				'',
				'Location not fount with this locationId.',
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
