import express from 'express';
import { paymentController } from '../../../controllers';
import { adminAuthMiddleware, paymentMiddleware, userAuthMiddleware } from '../../../middlewares';
const router = express.Router();

router.post('/process-payment', [userAuthMiddleware.verifyAuthJWTToken, paymentMiddleware.validateSquarePaymentBody], paymentController.makeSquarePayment);
router.get('/plans/list', paymentController.getPlans);
// Phase 10 (AUDIT S2): the payment list is platform-admin only.
router.get('/getAllPayments', adminAuthMiddleware.adminOnly('platform.read'), paymentController.getAllPayments);


export default router;