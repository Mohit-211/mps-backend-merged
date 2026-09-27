import express from 'express';
import * as organizationController from '../../../controllers/org/organization.controller';
import { userAuthMiddleware } from '../../../middlewares';
import { loadOrgContext, requireOwner, requireWrite, validateOrgUpdate } from '../../../middlewares/org/org.middleware';
import * as teamController from '../../../controllers/team/team.controller';
import { validateInvitationList, validateInvite, validateRoleChange } from '../../../middlewares/team/team.middleware';
import * as reportsController from '../../../controllers/reports/reports.controller';
import { validateBrandingUpdate, validateLogoUpload } from '../../../middlewares/reports/reports.middleware';

// The current organization (Phase 8), mounted at /api/v1/organization. The organization comes from the
// X-Organization-Id header or the user's default organization.
const router = express.Router();
const auth = [userAuthMiddleware.verifyAuthJWTToken, loadOrgContext];

router.get('/', auth, organizationController.get);
router.patch('/', [...auth, requireOwner, validateOrgUpdate], organizationController.update);
router.get('/usage', auth, organizationController.usage);
router.get('/members', [...auth, requireWrite], organizationController.members);
// Phase 11: team management (owner only).
const owner = [...auth, requireOwner];
router.patch('/members/:userId', [...owner, validateRoleChange], teamController.changeMemberRole);
router.delete('/members/:userId', owner, teamController.removeTeamMember);
router.post('/invitations', [...owner, validateInvite], teamController.invite);
router.get('/invitations', [...owner, validateInvitationList], teamController.listInvitations);
router.delete('/invitations/:invitationId', owner, teamController.revokeInvitation);
// Phase 12: report branding (white-label; changes are owner-only and agency-only).
router.get('/branding', auth, reportsController.getBranding);
router.put('/branding', [...owner, validateBrandingUpdate], reportsController.updateBranding);
router.get('/branding/logo', auth, reportsController.getLogo);
router.put('/branding/logo', [...owner, validateLogoUpload], reportsController.setLogo);
router.delete('/branding/logo', owner, reportsController.removeLogo);

export default router;
