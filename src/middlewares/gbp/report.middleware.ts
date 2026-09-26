import httpStatus from 'http-status';
import { REPORT_RANGES, ReportRange } from '../../gbp/report/performance';
import { catchAsync, responseWrapper } from '../../utils';

/** GET /locations/:id/gbp/report?range=28d|90d|12m (default 28d). */
export const validateGbpReportQuery = catchAsync(async (req, res, next) => {
	const range = req.query.range ?? '28d';
	if (typeof range !== 'string' || !(REPORT_RANGES as readonly string[]).includes(range)) {
		return responseWrapper(res, '', `range must be one of: ${REPORT_RANGES.join(', ')}`, httpStatus.BAD_REQUEST);
	}
	res.locals.reportRange = range as ReportRange;
	next();
});
