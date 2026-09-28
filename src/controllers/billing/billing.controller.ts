import httpStatus from 'http-status';
import { Response } from 'express';
import { loadEntitlement } from '../../services/billing/entitlement.service';
import { billingOverview, findInvoice, listInvoices, listLedger, publicPricing, tokenPacksFor, updateBillingDetails } from '../../services/billing/account.service';
import { invoiceService } from '../../services/billing/invoices';
import { orderService } from '../../services/billing/orders';
import { quoteSlots } from '../../services/billing/slots';
import { subscriptionService } from '../../services/billing/subscriptions';
import { OrgContext } from '../../services/org/context';
import { apiErrorWithData, catchAsync, responseWrapper } from '../../utils';

// Billing (Phase 13a), mounted at /api/v1/billing; /pricing is public. loadOrgContext ran.

const orgOf = (res: Response): OrgContext => res.locals.org as OrgContext;
const orgId = (res: Response) => orgOf(res).organization._id;
type Page = { page: number; limit: number };

export const overview = catchAsync(async (req, res) => responseWrapper(res, await billingOverview(orgId(res))));

export const checkout = catchAsync(async (req, res) => responseWrapper(res, await subscriptionService.checkout(orgId(res), orgOf(res).userId), 'Continue to PayPal to approve the subscription.', httpStatus.CREATED));

export const sync = catchAsync(async (req, res) => {
	await subscriptionService.sync(orgId(res));
	responseWrapper(res, await billingOverview(orgId(res)));
});

export const cancel = catchAsync(async (req, res) => {
	const input = res.locals.cancelInput as { reason?: string | null };
	await subscriptionService.cancel(orgId(res), input.reason || '', `user:${orgOf(res).userId}`);
	responseWrapper(res, await billingOverview(orgId(res)), 'Subscription cancelled. Access continues until the end of the paid period.');
});

export const slotsQuote = catchAsync(async (req, res) => {
	const { quantity } = res.locals.slotsInput as { quantity: number };
	const loaded = await loadEntitlement(String(orgId(res)));
	const max = loaded.plan.max_locations;
	if (max !== null && loaded.entitlement.locations.allowed + quantity > max) {
		throw apiErrorWithData(httpStatus.FORBIDDEN, 'More locations need an enterprise plan.', { reason: 'enterprise_required', max });
	}
	const quote = loaded.entitlement.read_only ? null : quoteSlots(loaded, quantity);
	if (!quote) throw apiErrorWithData(httpStatus.PAYMENT_REQUIRED, 'An active subscription is required to add location slots.', { reason: 'subscription_required' });
	responseWrapper(res, quote);
});

export const buySlots = catchAsync(async (req, res) => {
	const { quantity } = res.locals.slotsInput as { quantity: number };
	const r = await orderService.buySlots(orgId(res), orgOf(res).userId, quantity);
	responseWrapper(res, r, r.fulfilled ? 'Location slots added.' : 'Continue to PayPal to pay for the location slots.', r.fulfilled ? httpStatus.OK : httpStatus.CREATED);
});

export const tokenPacks = catchAsync(async (req, res) => responseWrapper(res, await tokenPacksFor(orgId(res))));

export const buyTokens = catchAsync(async (req, res) => {
	const input = res.locals.tokenInput as { pack_id: string; coupon_code?: string | null };
	const r = await orderService.buyTokens(orgId(res), orgOf(res).userId, input.pack_id, input.coupon_code || null);
	responseWrapper(res, r, r.fulfilled ? 'Tokens added.' : 'Continue to PayPal to pay for the tokens.', r.fulfilled ? httpStatus.OK : httpStatus.CREATED);
});

export const validateCoupon = catchAsync(async (req, res) => {
	const input = res.locals.tokenInput as { pack_id: string; coupon_code: string };
	const q = await orderService.packQuote(orgId(res), input.pack_id, input.coupon_code);
	responseWrapper(res, { pack_id: String(q.pack._id), currency: q.currency, price: q.price, discount: q.discount, total: q.total });
});

export const captureOrder = catchAsync(async (req, res) => {
	const r = await orderService.capture(orgId(res), String(req.params.orderId));
	responseWrapper(res, { ...r, billing: await billingOverview(orgId(res)) }, r.status === 'captured' ? 'Payment received.' : 'The payment is pending at PayPal.');
});

export const ledger = catchAsync(async (req, res) => {
	const { page, limit } = res.locals.pageInput as Page;
	responseWrapper(res, await listLedger(orgId(res), page, limit));
});

export const details = catchAsync(async (req, res) => responseWrapper(res, await updateBillingDetails(orgId(res), res.locals.detailsInput), 'Billing details saved.'));

export const invoices = catchAsync(async (req, res) => {
	const { page, limit } = res.locals.pageInput as Page;
	responseWrapper(res, await listInvoices(orgId(res), page, limit));
});

export const invoicePdf = catchAsync(async (req, res) => {
	const inv = await findInvoice(orgId(res), String(req.params.invoiceId));
	const data = await invoiceService.readPdf(inv);
	if (!data) throw apiErrorWithData(httpStatus.NOT_FOUND, 'The invoice PDF is not available.', { reason: 'not_found' });
	res.setHeader('Content-Type', 'application/pdf');
	res.setHeader('Content-Length', String(data.length));
	res.setHeader('Cache-Control', 'private, no-store');
	res.setHeader('X-Content-Type-Options', 'nosniff');
	res.setHeader('Content-Disposition', `attachment; filename="${inv.number}.pdf"`);
	res.status(httpStatus.OK).end(data);
});

export const pricing = catchAsync(async (req, res) => {
	const { country } = res.locals.pricingInput as { country: string };
	responseWrapper(res, await publicPricing(country));
});
