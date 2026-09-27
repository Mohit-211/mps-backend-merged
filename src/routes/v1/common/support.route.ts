import express from 'express';
import { supportController } from '../../../controllers';
import { adminAuthMiddleware, supportMiddleware, userAuthMiddleware } from '../../../middlewares';

const router = express.Router();

router.post('/', [userAuthMiddleware.verifyAuthJWTToken], [supportMiddleware.validCreateSupportBody], supportController.createSupport);
router.get('/', [userAuthMiddleware.verifyAuthJWTToken], supportController.getAllSupport);
router.delete('/:supportId', [userAuthMiddleware.verifyAuthJWTToken], supportController.deleteSupport);

// Phase 10 (AUDIT S2): the admin ticket views.
router.get('/getAllSupportByAdmin', adminAuthMiddleware.adminOnly('platform.read'), supportController.getAllSupportTicketsByAdmin);
router.put('/updateSupportTicketStatus', adminAuthMiddleware.adminOnly('platform.write'), supportController.updateSupportTicketStatus);
router.get('/getSupportTicketStatusCounts', adminAuthMiddleware.adminOnly('platform.read'), supportController.getSupportTicketStatusCounts);

export default router;