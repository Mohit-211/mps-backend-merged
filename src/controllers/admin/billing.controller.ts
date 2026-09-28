import httpStatus from 'http-status';
import { Response } from 'express';
import * as admin from '../../services/billing/admin.service';
import { AuditActor } from '../../services/billing/audit';
import { invoiceService } from '../../services/billing/invoices';
import { apiErrorWithData, catchAsync, responseWrapper } from '../../utils';

// Billing admin (Phase 13a): validateAdminJWTToken + billing.read / billing.manage ran; validated input
// is on res.locals.billingInput.

const actor = (res: Response): AuditActor => {
	const a = res.locals.admin as { id: string; name?: string | null };
	return { id: a.id, name: a.name ?? null };
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Joi-validated input
const input = (res: Response): any => res.locals.billingInput ?? {};
const p = (req: { params: Record<string, string> }, k: string) => String(req.params[k]);

export const listPlans = catchAsync(async (req, res) => responseWrapper(res, await admin.listPlans(input(res))));
export const getPlan = catchAsync(async (req, res) => responseWrapper(res, await admin.getPlan(p(req, 'planId'))));
export const updatePlan = catchAsync(async (req, res) => responseWrapper(res, await admin.updatePlan(actor(res), p(req, 'planId'), input(res)), 'Plan saved.'));
export const addPrice = catchAsync(async (req, res) => responseWrapper(res, await admin.addPlanPrice(actor(res), p(req, 'planId'), input(res)), 'Price saved. It applies from each organization\'s first renewal on or after its date.', httpStatus.CREATED));

export const organization = catchAsync(async (req, res) => responseWrapper(res, await admin.organizationBilling(p(req, 'organizationId'))));
export const createCustomPlan = catchAsync(async (req, res) => responseWrapper(res, await admin.createCustomPlan(actor(res), p(req, 'organizationId'), input(res)), 'Custom plan created.', httpStatus.CREATED));
export const removeCustomPlan = catchAsync(async (req, res) => responseWrapper(res, await admin.removeCustomPlan(actor(res), p(req, 'organizationId')), 'Back on the standard plan.'));
export const setBillingMethod = catchAsync(async (req, res) => responseWrapper(res, await admin.setBillingMethod(actor(res), p(req, 'organizationId'), input(res).billing_method), 'Billing method saved.'));
export const startManual = catchAsync(async (req, res) => responseWrapper(res, await admin.startManualSubscription(actor(res), p(req, 'organizationId'), input(res)), 'Manual subscription started.', httpStatus.CREATED));
export const extendTrial = catchAsync(async (req, res) => responseWrapper(res, await admin.extendTrial(actor(res), p(req, 'organizationId'), new Date(input(res).trial_ends_at)), 'Trial updated.'));
export const adjustTokens = catchAsync(async (req, res) => responseWrapper(res, await admin.adjustTokens(actor(res), p(req, 'organizationId'), input(res)), 'Tokens updated.'));
export const organizationLedger = catchAsync(async (req, res) => responseWrapper(res, await admin.organizationLedger(p(req, 'organizationId'), input(res).page, input(res).limit)));

export const listSubscriptions = catchAsync(async (req, res) => responseWrapper(res, await admin.listSubscriptions(input(res))));
export const getSubscription = catchAsync(async (req, res) => responseWrapper(res, await admin.getSubscription(p(req, 'subscriptionId'))));
export const syncSubscription = catchAsync(async (req, res) => responseWrapper(res, await admin.syncSubscription(actor(res), p(req, 'subscriptionId'))));
export const cancelSubscription = catchAsync(async (req, res) => responseWrapper(res, await admin.cancelSubscription(actor(res), p(req, 'subscriptionId'), input(res).reason || ''), 'Subscription cancelled.'));
export const updateSubscription = catchAsync(async (req, res) => responseWrapper(res, await admin.updateSubscription(actor(res), p(req, 'subscriptionId'), input(res)), 'Subscription saved.'));

export const listInvoices = catchAsync(async (req, res) => responseWrapper(res, await admin.listInvoicesAdmin(input(res))));
export const invoicePdf = catchAsync(async (req, res) => {
	const inv = await admin.loadInvoice(p(req, 'invoiceId'));
	const data = await invoiceService.readPdf(inv);
	if (!data) throw apiErrorWithData(httpStatus.NOT_FOUND, 'The invoice PDF is not available.', { reason: 'not_found' });
	res.setHeader('Content-Type', 'application/pdf');
	res.setHeader('Content-Length', String(data.length));
	res.setHeader('Cache-Control', 'private, no-store');
	res.setHeader('X-Content-Type-Options', 'nosniff');
	res.setHeader('Content-Disposition', `attachment; filename="${inv.number}.pdf"`);
	res.status(httpStatus.OK).end(data);
});
export const recordPayment = catchAsync(async (req, res) => responseWrapper(res, await admin.recordInvoicePayment(actor(res), p(req, 'invoiceId'), input(res).note), 'Payment recorded.'));
export const voidInvoice = catchAsync(async (req, res) => responseWrapper(res, await admin.voidInvoice(actor(res), p(req, 'invoiceId'), input(res).note), 'Invoice voided.'));

export const listPacks = catchAsync(async (req, res) => responseWrapper(res, await admin.listPacks()));
export const createPack = catchAsync(async (req, res) => responseWrapper(res, await admin.createPack(actor(res), input(res)), 'Token pack created.', httpStatus.CREATED));
export const updatePack = catchAsync(async (req, res) => responseWrapper(res, await admin.updatePack(actor(res), p(req, 'packId'), input(res)), 'Token pack saved.'));
export const listCoupons = catchAsync(async (req, res) => responseWrapper(res, await admin.listCoupons()));
export const createCoupon = catchAsync(async (req, res) => responseWrapper(res, await admin.createCoupon(actor(res), input(res)), 'Coupon created.', httpStatus.CREATED));
export const updateCoupon = catchAsync(async (req, res) => responseWrapper(res, await admin.updateCoupon(actor(res), p(req, 'couponId'), input(res)), 'Coupon saved.'));

export const legacyPayments = catchAsync(async (req, res) => responseWrapper(res, await admin.legacyPayments(Boolean(input(res).unlinked))));
export const linkLegacy = catchAsync(async (req, res) => responseWrapper(res, await admin.linkLegacy(actor(res), p(req, 'paymentId'), input(res).organization_id), 'Legacy payment linked.', httpStatus.CREATED));

export const auditLog = catchAsync(async (req, res) => responseWrapper(res, await admin.listAudit(input(res))));
