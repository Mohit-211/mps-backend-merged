import express from 'express';
import * as onboardingController from '../../../controllers/onboarding/onboarding.controller';
import { userAuthMiddleware } from '../../../middlewares';
import { validateAutocomplete, validatePlacesSearch } from '../../../middlewares/onboarding/onboarding.middleware';
import { loadOrgContext, requireWrite } from '../../../middlewares/org/org.middleware';
import { requireBilling } from '../../../middlewares/billing/billing.middleware';

// Places search, mounted at /api/v1/places: a competitor search for a location (?locationId=, 7a) or an
// add-location search (Phase 8). One paid call per request, counted against the user's daily Places limit.
const router = express.Router();

// 2026-10-01: the setup-center picker (Autocomplete (New); the pick is PUT /locations/:id/center { place_id, session }).
router.get('/autocomplete', [userAuthMiddleware.verifyAuthJWTToken, loadOrgContext, requireWrite, requireBilling, validateAutocomplete], onboardingController.autocompletePlaces);
router.get('/search', [userAuthMiddleware.verifyAuthJWTToken, loadOrgContext, requireWrite, requireBilling, validatePlacesSearch], onboardingController.searchPlaces);

export default router;
