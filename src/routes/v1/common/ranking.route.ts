import express from 'express';
import * as rankingController from '../../../controllers/ranking/ranking.controller';
import { userAuthMiddleware } from '../../../middlewares';
import { loadOwnedLocation, validateEstimateQuery, validateReportQuery, validateTrackingUpdate } from '../../../middlewares/ranking/ranking.middleware';
import * as onboardingController from '../../../controllers/onboarding/onboarding.controller';
import { validateCenter, validateSuggestionsQuery } from '../../../middlewares/onboarding/onboarding.middleware';
import * as refreshController from '../../../controllers/refresh/refresh.controller';
import { validateRefresh } from '../../../middlewares/refresh/refresh.middleware';
import * as gbpReportController from '../../../controllers/gbp/report.controller';
import { validateGbpReportQuery } from '../../../middlewares/gbp/report.middleware';
import { requireBilling, requireFeature } from '../../../middlewares/billing/billing.middleware';

// Ranking reports (CLAUDE.md §9.4), mounted at /api/v1/locations next to the location routes.
// Every route: user auth, then location ownership (404 for someone else's location).
const router = express.Router();
const owned = [userAuthMiddleware.verifyAuthJWTToken, loadOwnedLocation];

router.get('/:locationId/tracking', owned, rankingController.getTrackingSettings);
// Phase 17: what a grid / keyword count would need (calls, duration, cap) before saving it; no Google calls.
router.get('/:locationId/tracking/estimate', [...owned, validateEstimateQuery], rankingController.getTrackingEstimate);
router.put('/:locationId/tracking', [...owned, requireBilling, validateTrackingUpdate], rankingController.updateTrackingSettings);
router.post('/:locationId/rank-runs', [...owned, requireBilling], rankingController.createRankRun);
router.get('/:locationId/rank-runs', owned, rankingController.listRankRuns);
router.get('/:locationId/rank-runs/:runId', owned, rankingController.getRankRun);
router.get('/:locationId/rank-tracker', [...owned, requireFeature('rank_tracker'), validateReportQuery], rankingController.getRankTracker);
router.get('/:locationId/grid', [...owned, requireFeature('grid'), validateReportQuery], rankingController.getGrid);
router.get('/:locationId/map-ranking', [...owned, requireFeature('map_ranking'), validateReportQuery], rankingController.getMapRanking);
// Phase 7a onboarding: competitor suggestions (paid Places calls, 24 h cache, daily per-user limit).
router.get('/:locationId/competitor-suggestions', [...owned, requireBilling, validateSuggestionsQuery], onboardingController.competitorSuggestions);
// Phase 7a onboarding: manual business center (city / ZIP) for service-area businesses (2 Places calls).
router.put('/:locationId/center', [...owned, requireBilling, validateCenter], onboardingController.setCenter);
// Phase 7b: manual refresh (24 h per type) and GBP sync status.
router.post('/:locationId/refresh', [...owned, requireBilling, validateRefresh], refreshController.postRefresh);
router.get('/:locationId/refresh', owned, refreshController.getRefresh);
router.get('/:locationId/gbp/sync', owned, refreshController.getGbpSync);
// Phase 7c: the stored GBP report (generated in the gbp-report job).
router.get('/:locationId/gbp/report', [...owned, requireFeature('gbp_report'), validateGbpReportQuery], gbpReportController.getGbpReport);

export default router;
