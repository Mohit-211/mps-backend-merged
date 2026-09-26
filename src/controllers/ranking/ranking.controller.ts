import httpStatus from 'http-status';
import { ILocation } from '../../models/location.model';
import { RunOverCapError, getRunForLocation, listRuns, runStatusView } from '../../services/ranking/rankRun.service';
import { refreshLocation } from '../../services/refresh/refresh.service';
import { gridView, mapRankingView, rankTrackerView } from '../../services/ranking/rankReports.service';
import { getTracking, updateTracking } from '../../services/ranking/tracking.service';
import { TrackingUpdate } from '../../services/ranking/trackingSettings';
import { catchAsync, responseWrapper } from '../../utils';

// Ranking endpoints (CLAUDE.md §9.4). loadOwnedLocation has already checked ownership.

interface ReportQuery {
	runId?: string;
	keyword?: string;
	resolveNames?: boolean;
}

const location = (res: { locals: Record<string, unknown> }): ILocation => res.locals.location as ILocation;
const locationId = (res: { locals: Record<string, unknown> }): string => String(location(res)._id);
const reportQuery = (res: { locals: Record<string, unknown> }): ReportQuery => (res.locals.reportQuery ?? {}) as ReportQuery;

export const getTrackingSettings = catchAsync(async (req, res) => responseWrapper(res, getTracking(location(res))));

export const updateTrackingSettings = catchAsync(async (req, res) => {
	const result = await updateTracking(location(res), res.locals.trackingUpdate as TrackingUpdate);
	return responseWrapper(res, result, 'Tracking settings saved.');
});

// "Run now" = a rankings refresh: it shares the 24 h manual-refresh limit (7b).
export const createRankRun = catchAsync(async (req, res) => {
	try {
		const { rankings } = await refreshLocation(location(res), res.locals.userId as string, ['rankings']);
		if (!rankings || 'skipped' in rankings) {
			return responseWrapper(
				res,
				{ next_allowed_at: rankings?.next_allowed_at ?? null },
				'Refresh is limited to once per 24 hours per type.',
				httpStatus.TOO_MANY_REQUESTS,
			);
		}
		return responseWrapper(
			res,
			rankings,
			rankings.existing ? 'A run is already in progress for this location.' : 'Rank run queued.',
			httpStatus.ACCEPTED,
		);
	} catch (err) {
		if (err instanceof RunOverCapError) {
			return responseWrapper(res, { estimate: err.estimate, cap: err.cap }, err.message, httpStatus.UNPROCESSABLE_ENTITY);
		}
		throw err;
	}
});

export const getRankRun = catchAsync(async (req, res) => {
	const run = await getRunForLocation(locationId(res), req.params.runId);
	return responseWrapper(res, runStatusView(run));
});

export const listRankRuns = catchAsync(async (req, res) => {
	const page = Number(req.query.page) || 1;
	const limit = Math.min(Number(req.query.limit) || 15, 100);
	return responseWrapper(res, await listRuns(locationId(res), page, limit));
});

export const getRankTracker = catchAsync(async (req, res) =>
	responseWrapper(res, await rankTrackerView(locationId(res), reportQuery(res).runId)),
);

export const getGrid = catchAsync(async (req, res) => {
	const q = reportQuery(res);
	return responseWrapper(res, await gridView(locationId(res), q.keyword, q.runId));
});

export const getMapRanking = catchAsync(async (req, res) => {
	const q = reportQuery(res);
	return responseWrapper(res, await mapRankingView(locationId(res), q.keyword, q.runId, q.resolveNames === true));
});
