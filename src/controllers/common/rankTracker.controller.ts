import httpStatus from 'http-status';
import { responseWrapper, catchAsync, pick } from '../../utils';
import { rankTrackerService } from '../../services';

export const generateRankTrackerReport = catchAsync(async (req, res) => {
	const body = pick(req.body, ['location_id', 'scheduling', 'keywords', 'competitors', 'user', 'locationDoc'])
	const result = await rankTrackerService.generateRankTrackerReport(body);
	return responseWrapper(
		res,
		result,
		'Rank Tracker Report Generated Successfully.',
		httpStatus.CREATED,
	);
});

export const getRankTrackerReport = catchAsync(async (req, res) => {
	const body = pick(req.body, ['user', 'locationDoc']);
	const result = await rankTrackerService.getRankTrackerReport(body);
	return responseWrapper(
		res,
		result,
	);
});