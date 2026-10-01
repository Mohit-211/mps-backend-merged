import httpStatus from 'http-status';

import { responseWrapper, catchAsync, pick } from '../../utils';
import { gbpPSService } from '../../services';

export const unbindGoogleBusinessProfileWithUser = catchAsync(async (req, res) => {
    const body = pick(req.body, ['user', 'location_id'])
    const result = await gbpPSService.unbindGoogleBusinessProfileWithUser(body);
    return responseWrapper(
        res,
        result,
        'Google Business Profile unbound successfully'
    );
});

export const addPostToGBP = catchAsync(async (req, res) => {
    const body = pick(req.body, ['user', 'location_id', 'gbpAccountId', 'gbpLocationId','topicType', 'summary', 'callToAction', 'event', 'offer', 'schedule', 'mobile', 'gbpPostObj', 'userGBPDoc', 'gbpPostData'])
    const message = await gbpPSService.addPostToGBP(body);
    return responseWrapper(
        res,
        '',
        message
    );
});

export const getAllPostByLocationId = catchAsync(async (req, res) => {
    const body = pick(req.body, ['user', 'locationDoc', 'type'])
    const result = await gbpPSService.getAllPostByLocationId(body);
    return responseWrapper(
        res,
        result,
    );
});

export const deletePost = catchAsync(async (req, res) => {
    const body = pick(req.body, ['user', 'post_id'])
    await gbpPSService.deletePost(body);
    return responseWrapper(
        res,
        '',
        'Deleted Successfully'
    );
});
