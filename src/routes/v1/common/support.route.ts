import express from 'express';
import { supportController } from '../../../controllers';
import { supportMiddleware, userAuthMiddleware } from '../../../middlewares';

const router = express.Router();

router.post('/', [userAuthMiddleware.verifyAuthJWTToken], [supportMiddleware.validCreateSupportBody], supportController.createSupport);
router.get('/', [userAuthMiddleware.verifyAuthJWTToken], supportController.getAllSupport);
router.delete('/:supportId', [userAuthMiddleware.verifyAuthJWTToken], supportController.deleteSupport);

router.get('/getAllSupportByAdmin',  supportController.getAllSupportTicketsByAdmin);
router.put('/updateSupportTicketStatus',  supportController.updateSupportTicketStatus);
router.get('/getSupportTicketStatusCounts',  supportController.getSupportTicketStatusCounts);

export default router;