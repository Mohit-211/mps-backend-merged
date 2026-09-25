import httpStatus from 'http-status';

import { responseWrapper, ApiError, catchAsync, isValidMongoObjectId, compareObjectIds } from '../../utils';
import { citationTypesArr, membershipTypeArr } from '../../configs/constantTypes';
import { Location } from '../../models';

export const validGetCCitationListBody = catchAsync(async (req, res, next) => {
	try {
		const { user } = req.body;
		const { location_id } = req.params;

		if (!location_id) {
			return responseWrapper(
				res,
				'',
				'Please Provide Required Fields: location_id',
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

export const validAddNewCitationCampaignBody = catchAsync(async (req, res, next) => {
	try {
		const { user, location_id, aggregators, is_duplicate_remove, manual_citation_count, citations, is_all_aggregators_selected } = req.body;

		if (!location_id || !manual_citation_count || !citations) {
			return responseWrapper(
				res,
				'',
				'Please Provide Required Fields: location_id, manual_citation_count, citations',
				httpStatus.BAD_REQUEST,
			);
		};
		if (!aggregators) {
			req.body.aggregators = []
		} else {
			for (const aggregator of aggregators) {
				if (!aggregator._id || typeof aggregator._id !== 'string') {
					return responseWrapper(
						res,
						'',
						'Each aggregator must have a valid _id',
						httpStatus.BAD_REQUEST
					);
				}
				if (!aggregator.credit || typeof aggregator.credit !== 'number') {
					return responseWrapper(
						res,
						'',
						'Each aggregator must have a valid credit',
						httpStatus.BAD_REQUEST
					);
				}

				if (!aggregator.price || typeof aggregator.price !== 'number') {
					return responseWrapper(
						res,
						'',
						'Each aggregator must have a valid price',
						httpStatus.BAD_REQUEST
					);
				}

				if (!aggregator.name || typeof aggregator.name !== 'string') {
					return responseWrapper(
						res,
						'',
						'Each aggregator must have a valid name',
						httpStatus.BAD_REQUEST
					);
				}
			}
		}
		const newCitations = Array.isArray(citations.new) ? citations.new : [];
		const existingCitations = Array.isArray(citations.existing) ? citations.existing : [];

		// if (newCitations.length === 0 && existingCitations.length === 0) {
		// 	return responseWrapper(
		// 		res,
		// 		'',
		// 		'Invalid citations payload: at least one new or existing citation is required',
		// 		httpStatus.BAD_REQUEST
		// 	);
		// }

		for (const citation of newCitations) {
			if (!citation.directory_id || typeof citation.directory_id !== 'string') {
				return responseWrapper(
					res,
					'',
					'Each new citation must have a valid directory_id',
					httpStatus.BAD_REQUEST
				);
			}
			if (!citation.site_name || typeof citation.site_name !== 'string') {
				return responseWrapper(
					res,
					'',
					'Each new citation must have a valid site_name',
					httpStatus.BAD_REQUEST
				);
			}

			if (!citation.site_type || typeof citation.site_type !== 'string') {
				return responseWrapper(
					res,
					'',
					'Each new citation must have a valid site_type',
					httpStatus.BAD_REQUEST
				);
			}
			if (!citation.authority || typeof citation.authority !== 'number') {
				return responseWrapper(
					res,
					'',
					'Each new citation must have a valid authority',
					httpStatus.BAD_REQUEST
				);
			}
		}

		for (const citation of existingCitations) {
			if (!citation.directory_id || typeof citation.directory_id !== 'string') {
				return responseWrapper(
					res,
					'',
					'Each existing citation must have a valid directory_id',
					httpStatus.BAD_REQUEST
				);
			}

			if (!citation.site_name || typeof citation.site_name !== 'string') {
				return responseWrapper(
					res,
					'',
					'Each existing citation must have a valid site_name',
					httpStatus.BAD_REQUEST
				);
			}

			if (!citation.business_name || typeof citation.business_name !== 'string') {
				return responseWrapper(
					res,
					'',
					'Each existing citation must have a valid business_name',
					httpStatus.BAD_REQUEST
				);
			}

			if (!citation.zip_code || typeof citation.zip_code !== 'string') {
				return responseWrapper(
					res,
					'',
					'Each existing citation must have a valid zip_code',
					httpStatus.BAD_REQUEST
				);
			}

			if (!citation.phone_number || typeof citation.phone_number !== 'string') {
				return responseWrapper(
					res,
					'',
					'Each existing citation must have a valid phone_number',
					httpStatus.BAD_REQUEST
				);
			}

			if (!citation.site_type || typeof citation.site_type !== 'string') {
				return responseWrapper(
					res,
					'',
					'Each existing citation must have a valid site_type',
					httpStatus.BAD_REQUEST
				);
			}

			if (!citation.authority || typeof citation.authority !== 'number') {
				return responseWrapper(
					res,
					'',
					'Each existing citation must have a valid authority',
					httpStatus.BAD_REQUEST
				);
			}
		}


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
		req.body.is_duplicate_remove = is_duplicate_remove && is_duplicate_remove === 1 ? true : false;
		req.body.is_all_aggregators_selected = is_all_aggregators_selected && is_all_aggregators_selected === 1 ? true : false;
		if (typeof manual_citation_count !== 'number' || manual_citation_count <= 0) {
			return responseWrapper(
				res,
				'',
				'manual_citation_count must be a positive number',
				httpStatus.BAD_REQUEST,
			);
		}
		req.body.manual_citation_count = Number(manual_citation_count)
		req.body.aggregators = aggregators.filter(elm => elm.name !== 'All')

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

export const validAddNewCitationCampaignBusinesInfoBody = catchAsync(async (req, res, next) => {
	try {
		const {
			user,
			location_id,
			citation_location_id,
			campaign_id,
			is_white_lable,
			is_term_accepted,
			business_info,
			about_busines,
			opening_hours,
			accepted_payment_methods,
			additionalData,
			social_links,
			email_alerts
		} = req.body;

		if (!location_id || !citation_location_id || !business_info || is_white_lable === undefined || !about_busines || !opening_hours || !campaign_id || !is_term_accepted || !email_alerts) {
			return responseWrapper(
				res,
				'',
				'Please Provide Required Fields: location_id, citation_location_id, business_info, is_white_lable, about_busines, opening_hours, campaign_id, is_term_accepted, email_alerts',
				httpStatus.BAD_REQUEST,
			);
		}

		if (!isValidMongoObjectId(location_id)) {
			return responseWrapper(res, '', 'Invalid location_id provided', httpStatus.BAD_REQUEST);
		}
		if (!isValidMongoObjectId(citation_location_id)) {
			return responseWrapper(res, '', 'Invalid citation_location_id provided', httpStatus.BAD_REQUEST);
		}
		if (campaign_id && !isValidMongoObjectId(campaign_id)) {
			return responseWrapper(res, '', 'Invalid campaign_id provided', httpStatus.BAD_REQUEST);
		}

		const locationDoc = await Location.findOne({ _id: location_id, is_active: true });
		if (!locationDoc) {
			return responseWrapper(res, '', 'Location not found with this location_id.', httpStatus.BAD_REQUEST);
		}
		req.body.locationDoc = locationDoc;

		const requiredBusinessFields = ['name', 'country', 'address_line_1', 'city', 'postal_code', 'phone', 'website', 'contact_email', 'contact_phone'];
		for (const field of requiredBusinessFields) {
			if (!business_info[field] || typeof business_info[field] !== 'string' || !business_info[field].trim()) {
				return responseWrapper(res, '', `business_info.${field} is required and must be a non-empty string`, httpStatus.BAD_REQUEST);
			}
		}
		if (business_info.opening_date && isNaN(Date.parse(business_info.opening_date))) {
			return responseWrapper(res, '', 'business_info.opening_date must be a valid date string', httpStatus.BAD_REQUEST);
		}

		if (!about_busines.category || typeof about_busines.category !== 'string') {
			return responseWrapper(res, '', 'about_busines.category is required and must be a string', httpStatus.BAD_REQUEST);
		}
		if (about_busines.extra_categories && !Array.isArray(about_busines.extra_categories)) {
			return responseWrapper(res, '', 'about_busines.extra_categories must be an array of strings', httpStatus.BAD_REQUEST);
		}
		if (about_busines.list_of_services && !Array.isArray(about_busines.list_of_services)) {
			return responseWrapper(res, '', 'about_busines.list_of_services must be an array of strings', httpStatus.BAD_REQUEST);
		}
		if (about_busines.employees !== undefined && typeof about_busines.employees !== 'number') {
			return responseWrapper(res, '', 'about_busines.employees must be a number', httpStatus.BAD_REQUEST);
		}
		if (about_busines.year_founded !== undefined && typeof about_busines.year_founded !== 'number') {
			return responseWrapper(res, '', 'about_busines.year_founded must be a number', httpStatus.BAD_REQUEST);
		}

		if (!Array.isArray(opening_hours) || opening_hours.length === 0) {
			return responseWrapper(res, '', 'opening_hours must be a non-empty array', httpStatus.BAD_REQUEST);
		}
		for (const entry of opening_hours) {
			if (!entry.day || typeof entry.day !== 'string') {
				return responseWrapper(res, '', 'Each opening_hours entry must have a valid day', httpStatus.BAD_REQUEST);
			}
			if (!entry.type || typeof entry.type !== 'string') {
				return responseWrapper(res, '', 'Each opening_hours entry must have a valid type', httpStatus.BAD_REQUEST);
			}
		}

		if (accepted_payment_methods && !Array.isArray(accepted_payment_methods)) {
			return responseWrapper(res, '', 'accepted_payment_methods must be an array', httpStatus.BAD_REQUEST);
		}

		if (additionalData) {
			if (additionalData.reference_number && typeof additionalData.reference_number !== 'string') {
				return responseWrapper(res, '', 'additionalData.reference_number must be a string', httpStatus.BAD_REQUEST);
			}
			if (additionalData.notes && typeof additionalData.notes !== 'string') {
				return responseWrapper(res, '', 'additionalData.notes must be a string', httpStatus.BAD_REQUEST);
			}
		}

		if (social_links) {
			for (const key of ['facebook', 'instagram', 'twitter', 'linkedin', 'pinterest']) {
				if (social_links[key] && typeof social_links[key] !== 'string') {
					return responseWrapper(res, '', `social_links.${key} must be a string`, httpStatus.BAD_REQUEST);
				}
			}
		}

		if (email_alerts) {
			if (typeof email_alerts.enabled !== 'boolean' && email_alerts.enabled !== 0 && email_alerts.enabled !== 1) {
				return responseWrapper(res, '', 'email_alerts.enabled must be a boolean or 0/1', httpStatus.BAD_REQUEST);
			}
			if (email_alerts.email && typeof email_alerts.email !== 'string') {
				return responseWrapper(res, '', 'email_alerts.email must be a string', httpStatus.BAD_REQUEST);
			}
			req.body.email_alerts.enabled = email_alerts?.enabled !== 0 ? true : false
		}
		req.body.is_term_accepted = is_term_accepted !== 0 ? true : false

		next();
	} catch (error) {
		throw new ApiError(error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR, error.message);
	}
});

export const validGenerateCitationTrackerReportBody = catchAsync(async (req, res, next) => {
	try {
		const { location_id, scheduling, business_type, primary_location, user } = req.body;

		if (!location_id || !scheduling || !business_type || !primary_location) {
			return responseWrapper(
				res,
				'',
				'Please Provide Required Fields: location_id, scheduling, business_type, primary_location',
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

		const { frequency, run_at, time_zone } = scheduling;
		if (!frequency || !run_at || !time_zone) {
			return responseWrapper(
				res,
				'',
				'Please Provide Required Fields inside scheduling: frequency, run_at, time_zone.',
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

		if (!validateCategory(business_type)) {
			throw new ApiError(400, "Please enter a single business type, e.g. 'Hotels', not 'Hotels & Guest Houses'");
		}

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

function validateCategory(category: string): boolean {
	// Only allow letters, spaces, and max 2 words
	const forbidden = /[&\/,]/;
	return !forbidden.test(category);
}

