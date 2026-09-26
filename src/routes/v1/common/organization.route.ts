import express from 'express';
import * as organizationController from '../../../controllers/org/organization.controller';
import { userAuthMiddleware } from '../../../middlewares';
import { loadOrgContext, requireOwner, requireWrite, validateOrgUpdate } from '../../../middlewares/org/org.middleware';

// The current organization (Phase 8), mounted at /api/v1/organization. The organization comes from the
// X-Organization-Id header or the user's default organization.
const router = express.Router();
const auth = [userAuthMiddleware.verifyAuthJWTToken, loadOrgContext];

router.get('/', auth, organizationController.get);
router.patch('/', [...auth, requireOwner, validateOrgUpdate], organizationController.update);
router.get('/usage', auth, organizationController.usage);
router.get('/members', [...auth, requireWrite], organizationController.members);

export default router;
