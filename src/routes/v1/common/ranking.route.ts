import express from 'express';
import * as rankingController from '../../../controllers/ranking/ranking.controller';
import { userAuthMiddleware } from '../../../middlewares';
import { loadOwnedLocation, validateReportQuery, validateTrackingUpdate } from '../../../middlewares/ranking/ranking.middleware';

// Ranking reports (CLAUDE.md §9.4), mounted at /api/v1/locations next to the location routes.
// Every route: user auth, then location ownership (404 for someone else's location).
const router = express.Router();
const owned = [userAuthMiddleware.verifyAuthJWTToken, loadOwnedLocation];

router.get('/:locationId/tracking', owned, rankingController.getTrackingSettings);
router.put('/:locationId/tracking', [...owned, validateTrackingUpdate], rankingController.updateTrackingSettings);
router.post('/:locationId/rank-runs', owned, rankingController.createRankRun);
router.get('/:locationId/rank-runs', owned, rankingController.listRankRuns);
router.get('/:locationId/rank-runs/:runId', owned, rankingController.getRankRun);
router.get('/:locationId/rank-tracker', [...owned, validateReportQuery], rankingController.getRankTracker);
router.get('/:locationId/grid', [...owned, validateReportQuery], rankingController.getGrid);
router.get('/:locationId/map-ranking', [...owned, validateReportQuery], rankingController.getMapRanking);

export default router;
