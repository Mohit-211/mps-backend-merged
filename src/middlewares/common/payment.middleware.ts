import httpStatus from 'http-status';

import { responseWrapper, ApiError, catchAsync, isValidMongoObjectId } from '../../utils';
import { LocationCitation, PaymentCreditPlan } from '../../models';


export const validateSquarePaymentBody = catchAsync(async (req, res, next) => {
    try {
        const { token, citation_location_id, plan_id } = req.body;

        if (!plan_id || !token) {
            return responseWrapper(
                res,
                '',
                'Please Provide Required Fields: plan_id, token',
                httpStatus.BAD_REQUEST,
            );
        };
        if (!isValidMongoObjectId(plan_id)) {
            return responseWrapper(res, '', 'Invalid plan_id provided', httpStatus.BAD_REQUEST);
        }
        const planDoc = await PaymentCreditPlan.findById(plan_id)
        if (!planDoc) {
            return responseWrapper(res, '', 'Plan nt found', httpStatus.BAD_REQUEST);
        }
        req.body.planDoc = planDoc

        if (citation_location_id) {
            if (!isValidMongoObjectId(citation_location_id)) {
                return responseWrapper(res, '', 'Invalid citation_location_id provided', httpStatus.BAD_REQUEST);
            }
            const locationCitationDoc = await LocationCitation.findOne({ _id: citation_location_id, is_active: true });
            if (!locationCitationDoc) {
                return responseWrapper(res, '', 'Location Citation not found with this citation_location_id.', httpStatus.BAD_REQUEST);
            }
            req.body.locationCitationDoc = locationCitationDoc
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