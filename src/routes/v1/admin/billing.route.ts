import express from 'express';
import * as billing from '../../../controllers/admin/billing.controller';
import { adminOnly } from '../../../middlewares/auth/adminAuth.middleware';
import * as v from '../../../middlewares/billing/admin.validation';

// Billing admin (Phase 13a), mounted at /api/v1/admin/billing: billing.read to read, billing.manage to
// change (super admin, admin). Every change is audit-logged.
const router = express.Router();
const read = adminOnly('billing.read');
const manage = adminOnly('billing.manage');

router.get('/plans', [...read, v.validatePlanList], billing.listPlans);
router.get('/plans/:planId', read, billing.getPlan);
router.patch('/plans/:planId', [...manage, v.validatePlanUpdate], billing.updatePlan);
router.post('/plans/:planId/prices', [...manage, v.validatePrice], billing.addPrice);

router.get('/organizations/:organizationId', read, billing.organization);
router.post('/organizations/:organizationId/custom-plan', [...manage, v.validateCustomPlan], billing.createCustomPlan);
router.delete('/organizations/:organizationId/custom-plan', manage, billing.removeCustomPlan);
router.patch('/organizations/:organizationId/billing-method', [...manage, v.validateBillingMethod], billing.setBillingMethod);
router.post('/organizations/:organizationId/manual-subscription', [...manage, v.validateManualSubscription], billing.startManual);
router.post('/organizations/:organizationId/tokens', [...manage, v.validateTokens], billing.adjustTokens);
router.get('/organizations/:organizationId/tokens/ledger', [...read, v.validatePage], billing.organizationLedger);

router.get('/subscriptions', [...read, v.validateSubscriptionList], billing.listSubscriptions);
router.get('/subscriptions/:subscriptionId', read, billing.getSubscription);
router.patch('/subscriptions/:subscriptionId', [...manage, v.validateSubscriptionUpdate], billing.updateSubscription);
router.post('/subscriptions/:subscriptionId/sync', manage, billing.syncSubscription);
router.post('/subscriptions/:subscriptionId/cancel', [...manage, v.validateReason], billing.cancelSubscription);

router.get('/invoices', [...read, v.validateInvoiceList], billing.listInvoices);
router.get('/invoices/:invoiceId/pdf', read, billing.invoicePdf);
router.post('/invoices/:invoiceId/payments', [...manage, v.validateNote], billing.recordPayment);
router.post('/invoices/:invoiceId/void', [...manage, v.validateNote], billing.voidInvoice);

router.get('/token-packs', read, billing.listPacks);
router.post('/token-packs', [...manage, v.validatePackCreate], billing.createPack);
router.patch('/token-packs/:packId', [...manage, v.validatePackUpdate], billing.updatePack);
router.get('/coupons', read, billing.listCoupons);
router.post('/coupons', [...manage, v.validateCouponCreate], billing.createCoupon);
router.patch('/coupons/:couponId', [...manage, v.validateCouponUpdate], billing.updateCoupon);

router.get('/audit', [...read, v.validateAuditList], billing.auditLog);

export default router;
