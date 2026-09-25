import { responseWrapper, catchAsync, pick } from '../../utils';
import { reputationManagerService } from '../../services';


export const getMonitorReviewReport = catchAsync(async (req, res) => {
	const body = pick(req.body, ['user', 'locationDoc']);
	const result = await reputationManagerService.getMonitorReviewReport(body);
	return responseWrapper(
		res,
		result,
	);
});