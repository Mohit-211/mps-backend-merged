import express from 'express';
import { subscriptionController } from '../../../controllers';
const router = express.Router();


router.post('/', subscriptionController.createPlan);
router.get('/', subscriptionController.getAllPlans);
router.get('/plans/country/:country', subscriptionController.getPlansByCountry);
router.put('/:plan_id', subscriptionController.updatePlan);
router.delete('/:plan_id', subscriptionController.deletePlan);



router.post('/create-subscription', subscriptionController.createSubscription);
router.post('/paypal/webhook', subscriptionController.paypalWebhook);
router.get('/payment-status', subscriptionController.getPaymentStatus);


router.post('/coupon/generate', subscriptionController.generateCoupon);
router.post('/coupon/validate', subscriptionController.validateCoupon);
router.get('/coupons', subscriptionController.getAllCoupons);

// router.post('/cancel', [userAuthMiddleware.verifyAuthJWTToken], subscriptionController.cancelSubscription);

router.get('/payments/all', subscriptionController.getAllPaymentHistory);

router.post(
	'/send-subscription-welcome-mail',
	subscriptionController.sendSubscriptionWelcomeMailController,
);



export default router;