import express from 'express';
import { paymentController } from '../../../controllers';
import { paymentMiddleware, userAuthMiddleware } from '../../../middlewares';
const router = express.Router();

router.post('/process-payment', [userAuthMiddleware.verifyAuthJWTToken, paymentMiddleware.validateSquarePaymentBody], paymentController.makeSquarePayment);
router.get('/plans/list', paymentController.getPlans);
router.get('/getAllPayments', paymentController.getAllPayments);


export default router;