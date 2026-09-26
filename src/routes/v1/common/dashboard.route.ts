import express from 'express';
import * as dashboardController from '../../../controllers/dashboard/dashboard.controller';
import { userAuthMiddleware } from '../../../middlewares';
import { validateDashboardQuery } from '../../../middlewares/dashboard/dashboard.middleware';
import { loadOrgContext } from '../../../middlewares/org/org.middleware';

// Dashboard (Phase 11), mounted at /api/v1/dashboard: Business or Agency shape, stored summaries only.
const router = express.Router();

router.get('/', [userAuthMiddleware.verifyAuthJWTToken, loadOrgContext, validateDashboardQuery], dashboardController.get);

export default router;
