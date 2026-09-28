import express from 'express';
import * as billing from '../../../controllers/billing/billing.controller';
import { userAuthMiddleware } from '../../../middlewares';
import { loadOrgContext, requireOwner, requireWrite } from '../../../middlewares/org/org.middleware';
import * as v from '../../../middlewares/billing/billing.validation';

// Billing (Phase 13a), mounted at /api/v1/billing. Read: owner + member; payments and changes: owner.
// A client_user gets 403. Billing stays open when the organization is read-only.
const router = express.Router();
const read = [userAuthMiddleware.verifyAuthJWTToken, loadOrgContext, requireWrite];
const owner = [...read, requireOwner];

router.get('/', read, billing.overview);
router.post('/checkout', owner, billing.checkout);
router.post('/sync', owner, billing.sync);
router.post('/cancel', [...owner, v.validateCancel], billing.cancel);
router.get('/location-slots/quote', [...read, v.validateSlotsQuote], billing.slotsQuote);
router.post('/location-slots', [...owner, v.validateSlotsBuy], billing.buySlots);
router.get('/token-packs', read, billing.tokenPacks);
router.post('/tokens/checkout', [...owner, v.validateTokenCheckout], billing.buyTokens);
router.post('/coupon/validate', [...owner, v.validateCoupon], billing.validateCoupon);
router.post('/orders/:orderId/capture', owner, billing.captureOrder);
router.get('/tokens/ledger', [...read, v.validatePage], billing.ledger);
router.patch('/details', [...owner, v.validateDetails], billing.details);
router.get('/invoices', [...read, v.validatePage], billing.invoices);
router.get('/invoices/:invoiceId/pdf', read, billing.invoicePdf);

export default router;
