import { responseWrapper, catchAsync } from '../../utils';
import { timezoneService } from '../../services';

export const getAllTimezone = catchAsync(async (req, res) => {
    const result = await timezoneService.getAllTimezone(req.query);
    return responseWrapper(res, result);
});