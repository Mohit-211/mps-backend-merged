import express from 'express';
import * as citations from '../../../controllers/citations/customer.controller';
import { userAuthMiddleware } from '../../../middlewares';
import { validateCustomerChanges, validateCustomerList } from '../../../middlewares/citations/citations.validation';
import { loadOwnedLocation } from '../../../middlewares/ranking/ranking.middleware';

// Citations for organization users (Phase 16), mounted at /api/v1/locations. Read-only for every role;
// a client_user only for its clients' locations (loadOwnedLocation: another organization's location → 404).
const router = express.Router();
const owned = [userAuthMiddleware.verifyAuthJWTToken, loadOwnedLocation];

router.get('/:locationId/citations', [...owned, validateCustomerList], citations.overview);
router.get('/:locationId/citations/changes', [...owned, validateCustomerChanges], citations.changes);

export default router;
