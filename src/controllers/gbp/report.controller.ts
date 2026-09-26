import httpStatus from 'http-status';
import { ReportRange } from '../../gbp/report/performance';
import { ILocation } from '../../models';
import { getReportView } from '../../services/gbp/report.service';
import { catchAsync, responseWrapper } from '../../utils';

// GBP report (Phase 7c). Reads the stored report only; it is generated in the gbp-report job.
// loadOwnedLocation has already checked ownership.

export const getGbpReport = catchAsync(async (req, res) => {
	const location = res.locals.location as ILocation;
	const view = await getReportView(location, res.locals.reportRange as ReportRange);
	if (!view) {
		return responseWrapper(res, null, 'No GBP report yet: it is generated after the first rank run or GBP sync.', httpStatus.NOT_FOUND);
	}
	return responseWrapper(res, view);
});
