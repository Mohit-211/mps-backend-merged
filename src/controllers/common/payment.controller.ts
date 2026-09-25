import httpStatus from 'http-status';
import { responseWrapper, catchAsync, pick } from '../../utils';
import { paymentService } from '../../services';
import axios from 'axios';
import config from '../../configs/config';

export const makeSquarePayment = catchAsync(async (req, res) => {
    const body = pick(req.body, ['token', 'user', 'plan_id', 'planDoc', 'citation_location_id', 'locationCitationDoc'])
    const result = await paymentService.makeSquarePayment(body);
    return responseWrapper(
        res,
        result,
    );
});

export const getPlans = catchAsync(async (req, res) => {
    const body = pick(req.body, ['user'])
    const result = await paymentService.getPlans(body);
    return responseWrapper(
        res,
        result,
    );
});

export const getAllPayments = catchAsync(async (req, res) => {
    const result = await paymentService.getAllPayments();
    return responseWrapper(
        res,
        result,
    );
});