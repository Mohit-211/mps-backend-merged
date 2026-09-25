import express from 'express';
import { reputationManagerController } from '../../../controllers';
import { reputationManagerMiddleware, userAuthMiddleware } from '../../../middlewares';
const router = express.Router();

router.get('/monitor-reviews/:locationId', [userAuthMiddleware.verifyAuthJWTToken, reputationManagerMiddleware.validFetchMonitorReviewReportBody], reputationManagerController.getMonitorReviewReport);

export default router;