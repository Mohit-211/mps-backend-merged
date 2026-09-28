import express from 'express';
import * as panel from '../../../controllers/admin/adminPanel.controller';
import { adminOnly } from '../../../middlewares/auth/adminAuth.middleware';
import * as v from '../../../middlewares/admin/adminPanel.validation';

// Admin panel (Phase 13b), mounted at /api/v1/admin: overview, users, organizations (platform.read /
// platform.write) and support tickets (support.read / support.manage). Changes are audit-logged.
const router = express.Router();
const read = adminOnly('platform.read');
const write = adminOnly('platform.write');
const supportRead = adminOnly('support.read');
const supportManage = adminOnly('support.manage');

router.get('/overview', ...read, panel.overview);

router.get('/users', [...read, v.validateUserList], panel.listUsers);
router.get('/users/:userId', read, panel.getUser);
router.post('/users/:userId/disable', [...write, v.validateReason], panel.disableUser);
router.post('/users/:userId/enable', write, panel.enableUser);
router.post('/users/:userId/logout', write, panel.forceLogout);
router.post('/users/:userId/resend-verification', write, panel.resendVerification);
router.post('/users/:userId/verify', write, panel.markVerified);

router.get('/organizations', [...read, v.validateOrgList], panel.listOrganizations);
router.get('/organizations/:organizationId', read, panel.getOrganization);
router.post('/organizations/:organizationId/suspend', [...write, v.validateReason], panel.suspend);
router.post('/organizations/:organizationId/unsuspend', [...write, v.validateNote], panel.unsuspend);
router.patch('/organizations/:organizationId/trial', [...write, v.validateTrial], panel.extendTrial);
router.patch('/organizations/:organizationId/limits', [...write, v.validateLimits], panel.setLimits);

// counts comes before :ticketId
router.get('/support/tickets/counts', supportRead, panel.ticketCounts);
router.get('/support/tickets', [...supportRead, v.validateAdminTicketList], panel.listTickets);
router.get('/support/tickets/:ticketId', supportRead, panel.getTicket);
router.post('/support/tickets/:ticketId/messages', [...supportManage, v.validateAdminMessage], panel.replyTicket);
router.patch('/support/tickets/:ticketId', [...supportManage, v.validateTicketUpdate], panel.updateTicket);

export default router;
