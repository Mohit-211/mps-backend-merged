import httpStatus from 'http-status';
import { Types } from 'mongoose';
import config from '../../configs/config';
import logger from '../../configs/logger';
import { Currency, currencyFor } from '../../billing/constants';
import { applyCoupon, money, packPrice } from '../../billing/pricing';
import { IBillingPlan, IPaymentOrder, ITokenPack, PaymentOrder, Subscription, TokenPack } from '../../models';
import { apiErrorWithData } from '../../utils';
import { findCouponForPack, redeemCoupon } from './coupons';
import { loadEntitlement } from './entitlement.service';
import { invoiceService } from './invoices';
import { quoteSlots } from './slots';
import { OrderNotApprovedError, ProviderOrder, paymentProvider } from './providers';
import { BillingDeps, notConfigured } from './subscriptions';
import { credit } from './tokens';

// One-time provider orders (Phase 13a; PayPal today): token packs and prorated location slots. create → buyer approves
// → capture (return page or webhook, whichever is first) → exactly one fulfilment (compare-and-set).

type Id = Types.ObjectId | string;

const returnUrl = (query: string) => `${(config.auth.frontendUrl || '').replace(/\/$/, '')}/settings/billing?${query}`;

/** Packs with this organization's prices (custom per-pack price, else list price less the plan discount). */
export const packsFor = (packs: ITokenPack[], plan: Pick<IBillingPlan, 'token_pack_prices' | 'token_pack_discount_percent'>, currency: Currency) =>
	packs
		.map((p) => {
			const list = p.prices.find((x) => x.currency === currency)?.price;
			if (list === undefined) return null;
			const custom = plan.token_pack_prices?.find((x) => String(x.pack_id) === String(p._id) && x.currency === currency)?.price ?? null;
			return { id: String(p._id), name: p.name, tokens: p.tokens, currency, list_price: money(list), price: packPrice(list, custom, plan.token_pack_discount_percent ?? 0), expires_after_days: p.expires_after_days };
		})
		.filter((p): p is NonNullable<typeof p> => p !== null);

export const activePacks = () => TokenPack.find({ is_active: true }).sort({ sort_order: 1, tokens: 1 }).lean<ITokenPack[]>();

export const createOrderService = (deps: BillingDeps = {}) => {
	const pp = deps.provider ?? paymentProvider;
	const now = deps.now ?? (() => new Date());

	const packQuote = async (organizationId: Id, packId: string, couponCode: string | null) => {
		const loaded = await loadEntitlement(String(organizationId), now());
		const currency = loaded.subscription?.currency ?? currencyFor(loaded.organization.country);
		const pack = Types.ObjectId.isValid(packId) ? await TokenPack.findOne({ _id: packId, is_active: true }).lean<ITokenPack>() : null;
		const priced = pack ? packsFor([pack], loaded.plan, currency)[0] : null;
		if (!pack || !priced) throw apiErrorWithData(httpStatus.NOT_FOUND, 'Token pack not found.', { reason: 'pack_not_found' });
		const coupon = couponCode ? await findCouponForPack(couponCode, pack._id, now()) : null;
		const total = applyCoupon(priced.price, coupon);
		return { pack, priced, coupon, currency, ...total };
	};

	const startOrder = async (order: IPaymentOrder, description: string) => {
		try {
			const r = await pp().createOrder({
				orderId: String(order._id),
				amount: order.amount,
				currency: order.currency,
				description,
				returnUrl: returnUrl(`order=return&purpose=${order.purpose}`),
				cancelUrl: returnUrl(`order=cancelled&purpose=${order.purpose}`),
			});
			await PaymentOrder.updateOne({ _id: order._id }, { $set: { provider_order_id: r.providerId } });
			return { order_id: String(order._id), provider_order_id: r.providerId, approve_url: r.approveUrl, amount: order.amount, currency: order.currency };
		} catch (err) {
			await PaymentOrder.updateOne({ _id: order._id }, { $set: { status: 'failed', failure_reason: (err as Error).message.slice(0, 200) } });
			throw err;
		}
	};

	/** Buy a token pack → approve_url (a 100% coupon fulfils at once). */
	const buyTokens = async (organizationId: Id, userId: Id, packId: string, couponCode: string | null) => {
		const q = await packQuote(organizationId, packId, couponCode);
		const free = q.total <= 0;
		if (!free && !pp().configured()) throw notConfigured();
		const order = (
			await PaymentOrder.create({
				organization_id: organizationId,
				purpose: 'token_pack',
				amount: q.total,
				currency: q.currency,
				payload: { pack_id: q.pack._id, tokens: q.pack.tokens, coupon_id: q.coupon?._id ?? null, price: q.price, discount: q.discount, expires_after_days: q.pack.expires_after_days },
				created_by: userId,
			})
		).toObject() as IPaymentOrder;
		if (free) {
			await fulfil(order, null, 0);
			return { order_id: String(order._id), approve_url: null, fulfilled: true, amount: 0, currency: q.currency };
		}
		return { ...(await startOrder(order, `${q.pack.tokens} tokens (${q.pack.name})`)), fulfilled: false };
	};

	/** Extra location slots. Online billing: a prorated order; manual billing: granted now, billed on the next invoice. */
	const buySlots = async (organizationId: Id, userId: Id, quantity: number) => {
		const at = now();
		const loaded = await loadEntitlement(String(organizationId), at);
		const e = loaded.entitlement;
		if (e.read_only || !e.subscribed || !loaded.subscription || loaded.subscription.status === 'cancelled' || loaded.subscription.status === 'expired') {
			throw apiErrorWithData(httpStatus.PAYMENT_REQUIRED, 'An active subscription is required to add location slots.', { reason: 'subscription_required' });
		}
		const max = e.locations.max;
		if (max !== null && e.locations.allowed + quantity > max) {
			throw apiErrorWithData(httpStatus.FORBIDDEN, 'More locations need an enterprise plan.', { reason: 'enterprise_required', max });
		}
		const quote = quoteSlots(loaded, quantity, at);
		if (!quote) throw apiErrorWithData(httpStatus.PAYMENT_REQUIRED, 'An active subscription is required to add location slots.', { reason: 'subscription_required' });
		const sub = loaded.subscription;
		if (sub.billing_method === 'manual') {
			await Subscription.updateOne(
				{ _id: sub._id },
				{
					$inc: { paid_quantity: quantity },
					...(quote.amount > 0 && !(sub.comp_until && sub.comp_until > at) ? { $push: { pending_lines: { $each: quote.lines } } } : {}),
				},
			);
			logger.info(`billing: manual slots +${quantity} for organization ${String(organizationId)}`);
			return { order_id: null, approve_url: null, fulfilled: true, quote };
		}
		if (!pp().configured()) throw notConfigured();
		const order = (
			await PaymentOrder.create({
				organization_id: organizationId,
				purpose: 'location_slots',
				amount: quote.amount,
				currency: quote.currency,
				payload: { quantity, quote: { ...quote, period_end: quote.period_end.toISOString() }, subscription_id: sub._id },
				created_by: userId,
			})
		).toObject() as IPaymentOrder;
		return { ...(await startOrder(order, `${quantity} additional location slot${quantity === 1 ? '' : 's'}`)), fulfilled: false, quote };
	};

	/** The one-time effect of a captured order. Runs once (compare-and-set on status). */
	const fulfil = async (order: IPaymentOrder, captureId: string | null, charged: number): Promise<boolean> => {
		const at = now();
		const won = await PaymentOrder.findOneAndUpdate(
			{ _id: order._id, status: { $in: ['created', 'approved'] } },
			{ $set: { status: 'captured', provider_capture_id: captureId, captured_at: at } },
			{ new: true },
		).lean<IPaymentOrder>();
		if (!won) return false;
		const p = won.payload as IPaymentOrder['payload'] & { price?: number; discount?: number; subscription_id?: Types.ObjectId; expires_after_days?: number | null };
		let lines: { label: string; quantity: number; unit_price: number; amount: number }[];
		if (won.purpose === 'token_pack') {
			const tokens = Number(p.tokens ?? 0);
			const expires = p.expires_after_days ? new Date(at.getTime() + p.expires_after_days * 86_400_000) : null;
			await credit(won.organization_id, 'purchase', tokens, { ref: `order:${String(won._id)}`, note: `${tokens} tokens`, expires_at: expires }, at);
			if (p.coupon_id) await redeemCoupon(p.coupon_id);
			lines = [{ label: `${tokens} tokens`, quantity: 1, unit_price: money(p.price ?? won.amount), amount: money(p.price ?? won.amount) }];
			if (p.discount) lines.push({ label: 'Coupon', quantity: 1, unit_price: -money(p.discount), amount: -money(p.discount) });
		} else {
			const quantity = Number(p.quantity ?? 0);
			const q = p.quote as { lines?: typeof lines; period_end?: string } | undefined;
			const sub = await Subscription.findById(p.subscription_id).lean();
			// Slots bought after the renewal snapshot are already paid for the next period too.
			const prepaid = Boolean(sub?.next_renewal && sub.current_period_end && q?.period_end && sub.next_renewal.period_end.getTime() === sub.current_period_end.getTime() && (q.lines?.length ?? 0) > 1);
			await Subscription.updateOne({ _id: p.subscription_id }, { $inc: { paid_quantity: quantity, ...(prepaid ? { 'next_renewal.prepaid_quantity': quantity } : {}) } });
			lines = q?.lines ?? [{ label: 'Additional location slots', quantity, unit_price: won.amount, amount: won.amount }];
		}
		const invoice = await invoiceService.issue({
			organization_id: won.organization_id,
			subscription_id: (p as { subscription_id?: Types.ObjectId }).subscription_id ?? null,
			kind: won.purpose === 'token_pack' ? 'token_pack' : 'location_slots',
			status: 'paid',
			currency: won.currency,
			lines,
			provider_ref: captureId ?? `order:${String(won._id)}`,
			charged_amount: charged,
			paid_at: at,
		});
		await PaymentOrder.updateOne({ _id: won._id }, { $set: { invoice_id: invoice._id } });
		logger.info(`billing: order ${String(won._id)} (${won.purpose}) fulfilled`);
		return true;
	};


	/** Captures an approved order (idempotent). Returns the order's state. */
	const capture = async (organizationId: Id | null, providerOrderId: string) => {
		const order = await PaymentOrder.findOne({ provider_order_id: providerOrderId, ...(organizationId ? { organization_id: organizationId } : {}) }).lean<IPaymentOrder>();
		if (!order) throw apiErrorWithData(httpStatus.NOT_FOUND, 'Order not found.', { reason: 'order_not_found' });
		if (order.status === 'captured') return { status: 'captured' as const, order_id: String(order._id), purpose: order.purpose };
		if (order.status === 'failed' || order.status === 'expired') throw apiErrorWithData(httpStatus.CONFLICT, 'This order can no longer be paid.', { reason: 'order_closed' });
		const provider = pp();
		if (!provider.configured()) throw notConfigured();
		let result: ProviderOrder;
		try {
			result = await provider.captureOrder(providerOrderId, String(order._id));
		} catch (err) {
			if (err instanceof OrderNotApprovedError) throw apiErrorWithData(httpStatus.CONFLICT, 'The payment has not been approved yet.', { reason: 'order_not_approved' });
			throw err;
		}
		const c = result.capture;
		if (c && c.state === 'completed') {
			await fulfil(order, c.id, c.amount);
			return { status: 'captured' as const, order_id: String(order._id), purpose: order.purpose };
		}
		if (c && c.state === 'declined') {
			await PaymentOrder.updateOne({ _id: order._id, status: { $ne: 'captured' } }, { $set: { status: 'failed', failure_reason: 'capture declined' } });
			throw apiErrorWithData(httpStatus.PAYMENT_REQUIRED, 'The payment was declined.', { reason: 'payment_declined' });
		}
		await PaymentOrder.updateOne({ _id: order._id, status: 'created' }, { $set: { status: 'approved' } });
		return { status: 'pending' as const, order_id: String(order._id), purpose: order.purpose };
	};

	/** Webhook: the capture already happened at the provider. */
	const captureCompleted = async (providerOrderId: string, captureId: string, amount: number) => {
		const order = await PaymentOrder.findOne({ provider_order_id: providerOrderId }).lean<IPaymentOrder>();
		if (!order) return false;
		return fulfil(order, captureId, amount);
	};

	const captureDenied = async (providerOrderId: string) => {
		await PaymentOrder.updateOne({ provider_order_id: providerOrderId, status: { $in: ['created', 'approved'] } }, { $set: { status: 'failed', failure_reason: 'capture denied' } });
	};

	return { packQuote, buyTokens, buySlots, capture, captureCompleted, captureDenied, fulfil };
};

export type OrderService = ReturnType<typeof createOrderService>;
export const orderService = createOrderService();
