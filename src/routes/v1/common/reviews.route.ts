import express from 'express';
import * as reviews from '../../../controllers/reviews/reviews.controller';
import { userAuthMiddleware } from '../../../middlewares';
import { loadOwnedLocation } from '../../../middlewares/ranking/ranking.middleware';
import { requireBilling, requireFeature } from '../../../middlewares/billing/billing.middleware';
import {
	validateAnalyze,
	validateDraftText,
	validateDrafts,
	validateRegenerate,
	validateReportStatus,
	validateReviewList,
	validateSend,
} from '../../../middlewares/reviews/reviews.validation';

// Review management (Phase 18), mounted at /api/v1/locations. Reads for every member (client_user too);
// changes for owner / member (loadOwnedLocation answers 403 read_only otherwise). Nothing here runs in the
// background: Google is called on Refresh / Send / delete reply, OpenAI only on drafts / analyze / appeal-draft /
// insights, each spending MyPageSEO tokens.
const router = express.Router();
const owned = [userAuthMiddleware.verifyAuthJWTToken, loadOwnedLocation, requireFeature('gbp_report')];
const paid = [...owned, requireBilling];

router.get('/:locationId/reviews', [...owned, validateReviewList], reviews.list);
router.get('/:locationId/reviews/summary', owned, reviews.summary);
router.post('/:locationId/reviews/refresh', paid, reviews.refresh);
router.post('/:locationId/reviews/drafts', [...paid, validateDrafts], reviews.drafts);
router.post('/:locationId/reviews/send', [...paid, validateSend], reviews.send);
router.post('/:locationId/reviews/analyze', [...paid, validateAnalyze], reviews.analyze);
router.get('/:locationId/reviews/insights', owned, reviews.getInsights);
router.post('/:locationId/reviews/insights', paid, reviews.generateInsights);
router.put('/:locationId/reviews/:reviewId/draft', [...owned, validateDraftText], reviews.saveDraft);
router.delete('/:locationId/reviews/:reviewId/draft', owned, reviews.deleteDraft);
router.delete('/:locationId/reviews/:reviewId/reply', paid, reviews.deleteReply);
router.post('/:locationId/reviews/:reviewId/appeal-draft', [...paid, validateRegenerate], reviews.appealDraft);
router.patch('/:locationId/reviews/:reviewId/report-status', [...owned, validateReportStatus], reviews.reportStatus);

export default router;
