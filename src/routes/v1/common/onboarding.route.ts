import express from 'express';
import * as onboardingController from '../../../controllers/onboarding/onboarding.controller';
import { userAuthMiddleware } from '../../../middlewares';
import { validateComplete, validateSkip } from '../../../middlewares/onboarding/onboarding.middleware';
import { loadOrgContext, requireWrite } from '../../../middlewares/org/org.middleware';
import { requireBilling } from '../../../middlewares/billing/billing.middleware';

// Onboarding (Phase 7a; organizations since Phase 8), mounted at /api/v1/onboarding. Every route needs a
// user token; the organization comes from X-Organization-Id or the user's default organization.
const router = express.Router();
const auth = [userAuthMiddleware.verifyAuthJWTToken, loadOrgContext];

router.get('/state', auth, onboardingController.getState);
router.post('/complete', [...auth, requireWrite, requireBilling, validateComplete], onboardingController.complete);
router.post('/skip', [...auth, requireWrite, validateSkip], onboardingController.skipStep);

export default router;
