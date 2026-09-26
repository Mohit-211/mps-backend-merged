import httpStatus from 'http-status';
import { ILocation, RefreshType } from '../../models';
import { RunOverCapError } from '../../services/ranking/rankRun.service';
import { getSyncStatus } from '../../services/gbp/sync.service';
import { getRefreshState, refreshLocation } from '../../services/refresh/refresh.service';
import { catchAsync, responseWrapper } from '../../utils';

// Refresh (Mohit, 2026-09-26) and GBP sync status. loadOwnedLocation has already checked ownership.

const location = (res: { locals: Record<string, unknown> }): ILocation => res.locals.location as ILocation;

export const postRefresh = catchAsync(async (req, res) => {
	try {
		const result = await refreshLocation(location(res), res.locals.userId as string, res.locals.refreshTypes as RefreshType[] | undefined);
		const { all_rate_limited: limited, ...data } = result;
		if (limited) return responseWrapper(res, data, 'Refresh is limited to once per 24 hours per type.', httpStatus.TOO_MANY_REQUESTS);
		return responseWrapper(res, data, 'Refresh queued.', httpStatus.ACCEPTED);
	} catch (err) {
		if (err instanceof RunOverCapError) {
			return responseWrapper(res, { estimate: err.estimate, cap: err.cap }, err.message, httpStatus.UNPROCESSABLE_ENTITY);
		}
		throw err;
	}
});

export const getRefresh = catchAsync(async (req, res) => responseWrapper(res, await getRefreshState(location(res))));

export const getGbpSync = catchAsync(async (req, res) =>
	responseWrapper(res, await getSyncStatus(location(res), typeof req.query.syncId === 'string' ? req.query.syncId : undefined)),
);
