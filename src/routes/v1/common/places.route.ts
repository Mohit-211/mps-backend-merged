import express from 'express';
import * as onboardingController from '../../../controllers/onboarding/onboarding.controller';
import { userAuthMiddleware } from '../../../middlewares';
import { validatePlacesSearch } from '../../../middlewares/onboarding/onboarding.middleware';
import { loadOrgContext, requireWrite } from '../../../middlewares/org/org.middleware';

// Places search, mounted at /api/v1/places: a competitor search for a location (?locationId=, 7a) or an
// add-location search (Phase 8). One paid call per request, counted against the user's daily Places limit.
const router = express.Router();

router.get('/search', [userAuthMiddleware.verifyAuthJWTToken, loadOrgContext, requireWrite, validatePlacesSearch], onboardingController.searchPlaces);

export default router;
