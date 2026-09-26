import express from 'express';
import * as onboardingController from '../../../controllers/onboarding/onboarding.controller';
import { userAuthMiddleware } from '../../../middlewares';
import { validatePlacesSearch } from '../../../middlewares/onboarding/onboarding.middleware';

// Manual competitor search (Phase 7a), mounted at /api/v1/places. One paid call per request,
// counted against the user's daily Places limit.
const router = express.Router();

router.get('/search', [userAuthMiddleware.verifyAuthJWTToken, validatePlacesSearch], onboardingController.searchPlaces);

export default router;
