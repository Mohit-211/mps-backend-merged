import express from 'express';
import * as support from '../../../controllers/support/support.controller';
import { userAuthMiddleware } from '../../../middlewares';
import { loadOrgContext } from '../../../middlewares/org/org.middleware';
import * as v from '../../../middlewares/admin/adminPanel.validation';

// Support tickets (Phase 13b), mounted at /api/v1/support. Every organization role may open and follow
// tickets; a client_user sees only its own.
const router = express.Router();
const signedIn = [userAuthMiddleware.verifyAuthJWTToken, loadOrgContext];

router.post('/tickets', [...signedIn, v.validateTicketCreate], support.create);
router.get('/tickets', [...signedIn, v.validateTicketList], support.list);
router.get('/tickets/:ticketId', signedIn, support.get);
router.post('/tickets/:ticketId/messages', [...signedIn, v.validateMessage], support.reply);
router.post('/tickets/:ticketId/close', signedIn, support.close);

export default router;
