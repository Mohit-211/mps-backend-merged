import express from 'express';
import { rankTrackerController } from '../../../controllers';
import { rankTrackerMiddleware, userAuthMiddleware } from '../../../middlewares';
const router = express.Router();

router.post('/', [userAuthMiddleware.verifyAuthJWTToken, rankTrackerMiddleware.validCreateRankTrackerReportBody], rankTrackerController.generateRankTrackerReport);
router.get('/:locationId', [userAuthMiddleware.verifyAuthJWTToken, rankTrackerMiddleware.validFetchRankTrackerReportBody], rankTrackerController.getRankTrackerReport);

export default router;