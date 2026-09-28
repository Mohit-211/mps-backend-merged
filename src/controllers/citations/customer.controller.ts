import { CitationStatus } from '../../citations/constants';
import { ILocation } from '../../models';
import { citationCustomerService } from '../../services/citations/customer.service';
import { catchAsync, responseWrapper } from '../../utils';

// Citations for organization users (Phase 16), read-only. loadOwnedLocation ran (res.locals.location).

export const overview = catchAsync(async (req, res) => {
	const location = res.locals.location as ILocation;
	return responseWrapper(res, await citationCustomerService.overview(location, res.locals.citationInput as { status?: CitationStatus }), 'Citations.');
});

export const changes = catchAsync(async (req, res) => {
	const location = res.locals.location as ILocation;
	return responseWrapper(res, await citationCustomerService.changes(location._id, res.locals.citationInput as { page?: number; limit?: number }), 'Citation changes.');
});
