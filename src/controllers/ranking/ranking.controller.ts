import httpStatus from 'http-status';
import { ILocation } from '../../models/location.model';
import { RunOverCapError, getRunForLocation, listRuns, runStatusView } from '../../services/ranking/rankRun.service';
import { refreshLocation } from '../../services/refresh/refresh.service';
import { requestReportSafely } from '../../services/gbp/report.service';
import { gridView, mapRankingView, rankTrackerView } from '../../services/ranking/rankReports.service';
import { EstimateQuery, estimateTracking, getTracking, updateTracking } from '../../services/ranking/tracking.service';
import { TrackingUpdate, withDefaults } from '../../services/ranking/trackingSettings';
import { createGroup, deleteGroup, listGroups, updateGroup } from '../../services/ranking/keywordGroups';
import { keywordHistory } from '../../services/ranking/keywordHistory';
import { catchAsync, responseWrapper } from '../../utils';

// Ranking endpoints (CLAUDE.md §9.4). loadOwnedLocation has already checked ownership.

interface ReportQuery {
	runId?: string;
	keyword?: string;
	resolveNames?: boolean;
	point?: string;
	group?: string;
}

const location = (res: { locals: Record<string, unknown> }): ILocation => res.locals.location as ILocation;
const locationId = (res: { locals: Record<string, unknown> }): string => String(location(res)._id);
const reportQuery = (res: { locals: Record<string, unknown> }): ReportQuery => (res.locals.reportQuery ?? {}) as ReportQuery;

const groupOptions = (res: { locals: Record<string, unknown> }) => ({
	groups: withDefaults(location(res).tracking).keyword_groups,
	groupId: reportQuery(res).group,
});

export const listKeywordGroups = catchAsync(async (req, res) => responseWrapper(res, listGroups(location(res))));

export const createKeywordGroup = catchAsync(async (req, res) =>
	responseWrapper(res, await createGroup(location(res), res.locals.groupInput as { name: string; keywords: string[] }), 'Keyword group created.', httpStatus.CREATED),
);

export const updateKeywordGroup = catchAsync(async (req, res) =>
	responseWrapper(res, await updateGroup(location(res), req.params.groupId, res.locals.groupInput as { name?: string; keywords?: string[] }), 'Keyword group saved.'),
);

export const deleteKeywordGroup = catchAsync(async (req, res) =>
	responseWrapper(res, await deleteGroup(location(res), req.params.groupId), 'Keyword group deleted.'),
);

export const getKeywordHistory = catchAsync(async (req, res) => {
	const q = res.locals.historyQuery as { keyword: string; limit: number };
	return responseWrapper(res, await keywordHistory(location(res), q.keyword, q.limit));
});

export const getTrackingSettings = catchAsync(async (req, res) => responseWrapper(res, getTracking(location(res))));

export const getTrackingEstimate = catchAsync(async (req, res) =>
	responseWrapper(res, await estimateTracking(location(res), (res.locals.estimateQuery ?? {}) as EstimateQuery)),
);

export const updateTrackingSettings = catchAsync(async (req, res) => {
	// Phase 13a: no organization-wide keyword cap (the per-location cap RANK_MAX_KEYWORDS applies).
	const before = [...withDefaults(location(res).tracking).competitors].sort().join(',');
	const result = await updateTracking(location(res), res.locals.trackingUpdate as TrackingUpdate);
	// 7c: a changed competitor set refreshes an existing GBP report (only new competitors cost a Place Details call).
	const after = [...result.tracking.competitors].sort().join(',');
	if (before !== after && location(res).gbp_report?.last_generated_at) await requestReportSafely(locationId(res), 'competitors_changed');
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
	responseWrapper(res, await rankTrackerView(locationId(res), reportQuery(res).runId, groupOptions(res))),
);

export const getGrid = catchAsync(async (req, res) => {
	const q = reportQuery(res);
	return responseWrapper(res, await gridView(locationId(res), q.keyword, q.runId, groupOptions(res)));
});

export const getMapRanking = catchAsync(async (req, res) => {
	const q = reportQuery(res);
	return responseWrapper(res, await mapRankingView(locationId(res), q.keyword, q.runId, q.resolveNames === true, q.point));
});
