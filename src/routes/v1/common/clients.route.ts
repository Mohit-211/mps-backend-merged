import express from 'express';
import * as clientsController from '../../../controllers/clients/clients.controller';
import { userAuthMiddleware } from '../../../middlewares';
import { validateAssign, validateClientCreate, validateClientListQuery, validateClientUpdate } from '../../../middlewares/clients/clients.middleware';
import { loadOrgContext, requireAgency, requireWrite } from '../../../middlewares/org/org.middleware';

// Agency clients (Phase 8), mounted at /api/v1/clients. Agency organizations only (403 agency_only);
// a client_user sees only its own clients, read-only. Replaces the legacy /user/clients routes.
const router = express.Router();
const read = [userAuthMiddleware.verifyAuthJWTToken, loadOrgContext, requireAgency];
const write = [...read, requireWrite];

router.get('/', [...read, validateClientListQuery], clientsController.list);
router.post('/', [...write, validateClientCreate], clientsController.create);
router.get('/:clientId', read, clientsController.get);
router.patch('/:clientId', [...write, validateClientUpdate], clientsController.update);
router.delete('/:clientId', write, clientsController.remove);
router.post('/:clientId/locations', [...write, validateAssign], clientsController.assign);
router.delete('/:clientId/locations/:locationId', write, clientsController.unassign);

export default router;
