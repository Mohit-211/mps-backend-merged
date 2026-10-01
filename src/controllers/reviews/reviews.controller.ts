import httpStatus from 'http-status';
import { ILocation, ReviewReportStatus } from '../../models';
import { GOOGLE_ATTRIBUTION } from '../../constants/attribution';
import { ListQuery, reviewsService } from '../../services/reviews/reviews.service';
import { catchAsync, responseWrapper } from '../../utils';

// Review management (Phase 18). loadOwnedLocation has checked access (client_user: read-only).

interface Locals {
	locals: Record<string, unknown>;
}
const location = (res: Locals): ILocation => res.locals.location as ILocation;
const userId = (res: Locals): string => res.locals.userId as string;
const input = <T>(res: Locals): T => res.locals.reviewInput as T;

export const list = catchAsync(async (req, res) => {
	const q = input<Omit<ListQuery, 'rating'> & { rating?: number | string }>(res);
	const rating = q.rating === undefined ? undefined : String(q.rating).split(',').map(Number);
	return responseWrapper(res, { ...(await reviewsService.list(location(res), { ...q, rating })), attribution: GOOGLE_ATTRIBUTION });
});

export const summary = catchAsync(async (req, res) => responseWrapper(res, await reviewsService.summary(location(res))));

export const refresh = catchAsync(async (req, res) => responseWrapper(res, await reviewsService.refresh(location(res)), 'Reviews refreshed.'));

export const drafts = catchAsync(async (req, res) => {
	const b = input<{ review_ids: string[]; regenerate: boolean }>(res);
	return responseWrapper(res, await reviewsService.generateDrafts(location(res), userId(res), b.review_ids, b.regenerate), 'Reply drafts ready for review.');
});

export const saveDraft = catchAsync(async (req, res) =>
	responseWrapper(res, await reviewsService.saveDraft(location(res), req.params.reviewId, input<{ text: string }>(res).text), 'Draft saved.'),
);

export const deleteDraft = catchAsync(async (req, res) => responseWrapper(res, await reviewsService.deleteDraft(location(res), req.params.reviewId), 'Draft deleted.'));

export const send = catchAsync(async (req, res) => {
	const result = await reviewsService.send(location(res), userId(res), input<{ review_ids: string[] }>(res).review_ids);
	return responseWrapper(res, result, result.failed ? 'Some replies were not accepted by Google.' : 'Replies sent.');
});

export const deleteReply = catchAsync(async (req, res) => responseWrapper(res, await reviewsService.deleteReply(location(res), req.params.reviewId), 'Reply removed from Google.'));

export const analyze = catchAsync(async (req, res) => {
	const b = input<{ review_ids: string[]; regenerate: boolean }>(res);
	return responseWrapper(res, await reviewsService.analyze(location(res), userId(res), b.review_ids, b.regenerate), 'Analysis ready.');
});

export const appealDraft = catchAsync(async (req, res) =>
	responseWrapper(res, await reviewsService.appealDraft(location(res), userId(res), req.params.reviewId, input<{ regenerate: boolean }>(res).regenerate), 'Report draft ready.'),
);

export const reportStatus = catchAsync(async (req, res) =>
	responseWrapper(res, await reviewsService.setReportStatus(location(res), req.params.reviewId, input<{ status: ReviewReportStatus }>(res).status), 'Report status saved.'),
);

export const getInsights = catchAsync(async (req, res) => responseWrapper(res, await reviewsService.getInsights(location(res))));

export const generateInsights = catchAsync(async (req, res) =>
	responseWrapper(res, await reviewsService.generateInsights(location(res), userId(res)), 'Review insights generated.', httpStatus.CREATED),
);
