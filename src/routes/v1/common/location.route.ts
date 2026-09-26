import express from 'express';
import * as locationsController from '../../../controllers/locations/locations.controller';
import { userAuthMiddleware } from '../../../middlewares';
import { validateAddLocation, validateListQuery, validateLocationUpdate } from '../../../middlewares/locations/locations.middleware';
import { loadOrgContext, requireWrite } from '../../../middlewares/org/org.middleware';
import { loadOwnedLocation } from '../../../middlewares/ranking/ranking.middleware';

// Locations (Phase 8), mounted at /api/v1/locations. Replaces the legacy routes (manual create, an
// unauthenticated detail route, created_by-scoped list/update/delete and the google-locations proxies).
// Location modules (tracking, rank runs, refresh, GBP report…) are in ranking.route.ts.
const router = express.Router();
const auth = userAuthMiddleware.verifyAuthJWTToken;

router.get('/', [auth, loadOrgContext, validateListQuery], locationsController.list);
router.post('/', [auth, loadOrgContext, requireWrite, validateAddLocation], locationsController.add);
router.get('/:locationId', [auth, loadOwnedLocation], locationsController.get);
router.get('/:locationId/overview', [auth, loadOwnedLocation], locationsController.overview);
router.patch('/:locationId', [auth, loadOwnedLocation, validateLocationUpdate], locationsController.update);
router.delete('/:locationId', [auth, loadOwnedLocation], locationsController.remove);

export default router;
