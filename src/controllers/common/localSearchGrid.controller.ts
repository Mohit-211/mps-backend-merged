import httpStatus from 'http-status';
import { responseWrapper, catchAsync, pick } from '../../utils';
import { localSearchGridService } from '../../services';

export const generateLocalSearchGridReport = catchAsync(async (req, res) => {
	const body = pick(req.body, ['location_id', 'scheduling', 'keywords', 'map_criteria', 'user', 'locationDoc'])
	const result = await localSearchGridService.generateLocalSearchGridReport(body);
	return responseWrapper(
		res,
		result,
		'Local Search Grid Report Generated Successfully.',
		httpStatus.CREATED,
	);
});

export const getLocalSearchGridReport = catchAsync(async (req, res) => {
	const body = pick(req.body, ['user', 'locationDoc']);
	const result = await localSearchGridService.getLocalSearchGridReport(body);
	return responseWrapper(
		res,
		result,
	);
});