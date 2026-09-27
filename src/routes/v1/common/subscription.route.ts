import express from 'express';
import { subscriptionController } from '../../../controllers';
import { adminAuthMiddleware } from '../../../middlewares';
const router = express.Router();


// Phase 10 (AUDIT S2): plan management, coupons and payment lists are platform-admin only. The checkout
// routes (plans by country, create-subscription, payment-status, coupon/validate) and the PayPal webhook stay public.
const read = adminAuthMiddleware.adminOnly('platform.read');
const write = adminAuthMiddleware.adminOnly('platform.write');
router.post('/', write, subscriptionController.createPlan);
router.get('/', read, subscriptionController.getAllPlans);
router.get('/plans/country/:country', subscriptionController.getPlansByCountry);
router.put('/:plan_id', write, subscriptionController.updatePlan);
router.delete('/:plan_id', write, subscriptionController.deletePlan);



router.post('/create-subscription', subscriptionController.createSubscription);
router.post('/paypal/webhook', subscriptionController.paypalWebhook);
router.get('/payment-status', subscriptionController.getPaymentStatus);


router.post('/coupon/generate', write, subscriptionController.generateCoupon);
router.post('/coupon/validate', subscriptionController.validateCoupon);
router.get('/coupons', read, subscriptionController.getAllCoupons);

// router.post('/cancel', [userAuthMiddleware.verifyAuthJWTToken], subscriptionController.cancelSubscription);

router.get('/payments/all', read, subscriptionController.getAllPaymentHistory);

router.post(
	'/send-subscription-welcome-mail',
	write,
	subscriptionController.sendSubscriptionWelcomeMailController,
);



export default router;