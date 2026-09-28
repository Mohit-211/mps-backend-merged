import express from 'express';
import { paypalWebhook } from '../../../controllers/billing/webhook.controller';

// Phase 13a: only the PayPal webhook remains here (its URL is registered at PayPal). The legacy guest
// checkout, plan CRUD, coupons and payment lists were retired; billing is /billing, admin /admin/billing.
const router = express.Router();
router.post('/paypal/webhook', paypalWebhook);

export default router;
