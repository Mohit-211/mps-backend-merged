import httpStatus from 'http-status';

import { responseWrapper, catchAsync, pick } from '../../utils';
import { gbpAuditService } from '../../services';

export const generateGBPAuditReport = catchAsync(async (req, res) => {
	const body = pick(req.body, ['location_id', 'scheduling', 'keywords', 'user', 'locationDoc'])
	const result = await gbpAuditService.generateGBPAuditReport(body);
	return responseWrapper(
		res,
		result,
		'GBP Audit Report Generated Successfully.',
		httpStatus.CREATED,
	);
});

export const getGBPAuditReport = catchAsync(async (req, res) => {
	const body = pick(req.body, ['user', 'locationDoc']);
	const result = await gbpAuditService.getGBPAuditReport(body);
	return responseWrapper(
		res,
		result,
	);
});