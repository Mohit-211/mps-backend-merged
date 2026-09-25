import httpStatus from 'http-status';
import { responseWrapper, catchAsync, pick } from '../../utils';
import { localMapRankingService } from '../../services';


export const generateLocalMapRankingReport = catchAsync(async (req, res) => {
    const body = pick(req.body, ['location_id', 'scheduling', 'keywords', 'map_criteria', 'user', 'locationDoc'])
    const result = await localMapRankingService.generateLocalMapRankingReport(body);
    return responseWrapper(
        res,
        result,
        'Local Map Ranking Report Generated Successfully.',
        httpStatus.CREATED,
    );
});

export const getLocalMapRankingReport = catchAsync(async (req, res) => {
    const body = pick(req.body, ['user', 'locationDoc']);
    const result = await localMapRankingService.getLocalMapRankingReport(body);
    return responseWrapper(
        res,
        result,
    );
});
