import express from 'express';
import * as onboardingController from '../../../controllers/onboarding/onboarding.controller';
import { userAuthMiddleware } from '../../../middlewares';
import { validateComplete, validateSelectProfile } from '../../../middlewares/onboarding/onboarding.middleware';

// Onboarding (Phase 7a), mounted at /api/v1/onboarding. Every route needs a user token.
const router = express.Router();
const auth = [userAuthMiddleware.verifyAuthJWTToken];

router.get('/state', auth, onboardingController.getState);
router.get('/gbp-profiles', auth, onboardingController.listProfiles);
router.post('/select-profile', [...auth, validateSelectProfile], onboardingController.selectProfile);
router.post('/complete', [...auth, validateComplete], onboardingController.complete);

export default router;
