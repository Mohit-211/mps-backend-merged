import httpStatus from 'http-status';

import { responseWrapper, ApiError, catchAsync, isValidMongoObjectId } from '../../utils';
import { Location, UserGBP } from '../../models';
import { gbpCallToAction, gbpCallToActionArr, gbpPostTopicType, gbpPostTopicTypeArr, postPublishStatus } from '../../configs/constantTypes';
import config from '../../configs/config';
import { FilesDefinition } from '../../types/RouteDefinition';

export const validateBindGBPbody = catchAsync(async (req, res, next) => {
	try {
		const { user, gbpAccountId, gbpLocationId, title, websiteUri, languageCode, metadata, profile, location_id } = req.body;

		if (!gbpAccountId || !gbpLocationId || !title || !websiteUri || !languageCode || !metadata || !profile || !location_id) {
			return responseWrapper(
				res,
				'',
				'Please Provide Required Fields: gbpAccountId, gbpLocationId, title, websiteUri,  languageCode, metadata, profile, location_id',
				httpStatus.BAD_REQUEST,
			);
		};
		if (typeof metadata !== 'object' || typeof profile !== 'object') {
			return responseWrapper(
				res,
				'',
				'metadata and profile must be object',
				httpStatus.BAD_REQUEST,
			);
		};
		if (!user.is_gbp_connected) {
			return responseWrapper(
				res,
				'',
				'Please connect GBP first',
				httpStatus.BAD_REQUEST,
			);
		}
		if (!gbpAccountId.includes('accounts/')) {
			return responseWrapper(
				res,
				'',
				'Invalid gbpAccountId format it must be starts with accounts/.',
				httpStatus.BAD_REQUEST,
			);
		}
		if (!gbpLocationId.includes('locations/')) {
			return responseWrapper(
				res,
				'',
				'Invalid gbpLocationId format it must be starts with locations/.',
				httpStatus.BAD_REQUEST,
			);
		}
		if (!gbpAccountId.includes('accounts/')) {
			return responseWrapper(
				res,
				'',
				'Please connect GBP first',
				httpStatus.BAD_REQUEST,
			);
		}
		if (!isValidMongoObjectId(location_id)) {
			return responseWrapper(
				res,
				'',
				'Invalid location_id provided',
				httpStatus.BAD_REQUEST,
			);
		};
		const locationDoc = await Location.findOne({ _id: location_id, created_by: user._id, is_active: true });
		if (!locationDoc) {
			return responseWrapper(
				res,
				'',
				'Location not found with this location_id.',
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

export const validateGBPPostbody = catchAsync(async (req, res, next) => {
	try {
		let { user, location_id, gbpAccountId, gbpLocationId, topicType, summary, callToAction, event, offer, schedule } = req.body;
		let { images, videos }: FilesDefinition = req.files;

		let gbpPostObj = {
			location_id,
			gbpAccountId,
			gbpLocationId,
			summary,
			topicType,
		};
		let gbpPostData: {} = {
			languageCode: 'en',
			summary,
			topicType
		}

		if (!location_id || !gbpAccountId || !gbpLocationId || !topicType || !summary) {
			return responseWrapper(
				res,
				'',
				'Please Provide Required Fields: location_id, gbpAccountId,gbpLocationId, topicType,  summary',
				httpStatus.BAD_REQUEST,
			);
		};

		if (!gbpPostTopicTypeArr.includes(topicType)) {
			return responseWrapper(
				res,
				'',
				'Invalid topicType.',
				httpStatus.BAD_REQUEST,
			);
		};
		if (!gbpAccountId.includes('accounts/')) {
			return responseWrapper(
				res,
				'',
				'Invalid gbpAccountId format it must be starts with accounts/.',
				httpStatus.BAD_REQUEST,
			);
		};
		if (!gbpLocationId.includes('locations/')) {
			return responseWrapper(
				res,
				'',
				'Invalid gbpLocationId format it must be starts with locations/.',
				httpStatus.BAD_REQUEST,
			);
		};

		if (schedule) {
			schedule = JSON.parse(req.body.schedule)
			req.body.schedule = schedule
			let { timeZone, date, time } = schedule;
			if (!timeZone || !date || !time) {
				return responseWrapper(
					res,
					'',
					'Please Provide Required Fields: timeZone, date, time inside schedule object',
					httpStatus.BAD_REQUEST,
				);
			}
			if (!/^(19|20)\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date)) {
				return responseWrapper(
					res,
					'',
					'Invalid date inside schedule. Invalid date format(YYYY-MM-DD) or range',
					httpStatus.BAD_REQUEST
				);
			}

			if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
				return responseWrapper(
					res,
					'',
					'Invalid time inside schedule. Expected format: HH:MM (24-hour)',
					httpStatus.BAD_REQUEST
				);
			}
			gbpPostObj['schedule'] = schedule;
			gbpPostObj['is_posted'] = false;
			gbpPostObj['is_scheduled'] = true;
			gbpPostObj['status'] = postPublishStatus.scheduled
		} else {
			gbpPostObj['is_posted'] = true;
			gbpPostObj['is_scheduled'] = false;
			gbpPostObj['status'] = postPublishStatus.live
		}
		if (topicType !== gbpPostTopicType.STANDARD) {
			if (!event) {
				return responseWrapper(
					res,
					'',
					`When topicType is not ${gbpPostTopicType.STANDARD}, event data is required`,
					httpStatus.BAD_REQUEST,
				);
			}
			event = JSON.parse(req.body.event)
			req.body.event = event
			let { title, schedule } = event
			if (!title || !schedule) {
				return responseWrapper(
					res,
					'',
					`title, schedule is required inside event data`,
					httpStatus.BAD_REQUEST,
				);
			}

			let { startDate, endDate } = schedule	
			if (!startDate || !endDate) {
				return responseWrapper(
					res,
					'',
					`startDate, endDate is required inside event schedule data`,
					httpStatus.BAD_REQUEST,
				);
			}					
			if (!startDate.year || !startDate.month || !startDate.day) {
				return responseWrapper(
					res,
					'',
					`year, month, day is required inside event startDate`,
					httpStatus.BAD_REQUEST,
				);
			}
			if (!endDate.year || !endDate.month || !endDate.day) {
				return responseWrapper(
					res,
					'',
					`year, month, day is required inside event endDate`,
					httpStatus.BAD_REQUEST,
				);
			}
			gbpPostObj['event'] = event
			gbpPostData['event'] = {
				title, schedule
			}
		}
		if (offer) {
			offer = JSON.parse(req.body.offer)
			req.body.offer = offer
			gbpPostObj['offer'] = offer
			let postOffer: {} = {}
			const { couponCode, redeemOnlineUrl, termsConditions } = offer
			if (couponCode) {
				postOffer['couponCode'] = couponCode
			}
			if (redeemOnlineUrl) {
				postOffer['redeemOnlineUrl'] = redeemOnlineUrl
			}
			if (termsConditions) {
				postOffer['termsConditions'] = termsConditions
			}
			gbpPostData['offer'] = postOffer
		}

		if (!isValidMongoObjectId(location_id)) {
			return responseWrapper(
				res,
				'',
				'Invalid location_id provided',
				httpStatus.BAD_REQUEST,
			);
		};
		const locationDoc = await Location.findOne({ _id: location_id, created_by: user._id, is_active: true });
		if (!locationDoc) {
			return responseWrapper(
				res,
				'',
				'Location not found with this location_id.',
				httpStatus.BAD_REQUEST,
			);
		};

		const userGBPDoc = await UserGBP.findOne({ location_id: location_id, gbpAccountId, gbpLocationId, is_active: true });
		if (!userGBPDoc) {
			return responseWrapper(
				res,
				'',
				'No GBP Account is bound with this location',
				httpStatus.BAD_REQUEST,
			);
		}
		if (!callToAction) {
			callToAction = {
				actionType: gbpCallToAction.NONE,
				url: null
			}
			gbpPostObj['callToAction'] = callToAction
		}else{
			callToAction = JSON.parse(req.body.callToAction)
			req.body.callToAction = callToAction
		}

		if (callToAction && callToAction.actionType && callToAction.actionType !== gbpCallToAction.NONE) {
			if (!gbpCallToActionArr.includes(callToAction.actionType)) {
				return responseWrapper(
					res,
					'',
					'Invalid actionType inside callToAction object.',
					httpStatus.BAD_REQUEST,
				);
			}
			if (callToAction.actionType === gbpCallToAction.CALL_NOW) {
				gbpPostObj['callToAction'] = {
					actionType: gbpCallToAction.CALL_NOW,
				}
				callToAction.url = null;
			} else {
				if (typeof callToAction !== 'object' || !['actionType', 'url'].every(key => key in callToAction)) {
					return responseWrapper(
						res,
						'',
						'Invalid callToAction. It must be an object with containg actionType and url key.',
						httpStatus.BAD_REQUEST,
					);
				}
				if (!/^(https?:\/\/)?([a-zA-Z0-9\-]+\.)+[a-zA-Z]{2,}(\/\S*)?$/.test(callToAction.url)) {
					return responseWrapper(
						res,
						'',
						'Invalid url inside callToAction object.',
						httpStatus.BAD_REQUEST,
					);
				}
			}
			gbpPostObj['callToAction'] = callToAction
		}

		let media: {} = {};
		if (images && Array.isArray(images) && images.length !== 0) {
			let currImage = images[0];
			if (currImage.filename) {
				media['mediaFormat'] = 'PHOTO',
					media['sourceUrl'] = `${config.constants.apiBaseUrl}/images/${currImage.filename}`
			}
		} else if (videos && Array.isArray(videos) && videos.length !== 0) {
			let currVideo = videos[0];
			if (currVideo.filename) {
				media['mediaFormat'] = 'VIDEO',
					media['sourceUrl'] = `${config.constants.apiBaseUrl}/videos/${currVideo.filename}`
			}

		}
		if (media && Object.keys(media).length !== 0) {
			gbpPostObj['media'] = media
			gbpPostData['media'] = media
		}

		req.body.locationDoc = locationDoc;
		req.body.userGBPDoc = userGBPDoc;
		req.body.gbpPostObj = gbpPostObj;
		req.body.gbpPostData = gbpPostData;
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

function checkStartAndEndDate(startDate: string, endDate: string, type: string) {
	const dateRegex = /^(19|20)\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

	if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
		return {
			status: false,
			message: `Start date or end date is not in valid format (YYYY-MM-DD) or range inside ${type}.`
		};
	}

	const now = new Date();
	const start = new Date(startDate);
	const end = new Date(endDate);

	now.setHours(0, 0, 0, 0);

	if (start < now) {
		return {
			status: false,
			message: `Start date must not be in the past inside ${type}.`
		};
	}

	if (end <= start) {
		return {
			status: false,
			message: `End date must be after start date inside ${type}.`
		};
	}

	return {
		status: true,
		message: ''
	};
}

export const validateGetAllPostbody = catchAsync(async (req, res, next) => {
	try {
		const { user } = req.body;
		const { location_id, type } = req.params;

		if (!location_id || !type) {
			return responseWrapper(
				res,
				'',
				'Please Provide Required Fields: location_id and type',
				httpStatus.BAD_REQUEST,
			);
		};

		const locationDoc = await Location.findOne({ _id: location_id, created_by: user._id, is_active: true });
		if (!locationDoc) {
			return responseWrapper(
				res,
				'',
				'Location not found with this location_id.',
				httpStatus.BAD_REQUEST,
			);
		};
		req.body.locationDoc = locationDoc;
		req.body.type = type;
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