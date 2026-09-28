import { Currency } from './constants';

// Billing math (Phase 13a), pure. Monthly = first + (n − 1) × additional. Prices are dated per currency;
// a renewal uses the price in effect at that renewal. Prorated slots are always additional locations.

export interface DatedPrice {
	currency: Currency;
	first_location_price: number;
	additional_location_price: number;
	effective_from: Date;
}

export interface Price {
	first: number;
	additional: number;
}

/** Rounds to cents (half away from zero). */
export const money = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100;

/** The price in effect at `at` for the currency (the latest effective_from ≤ at), or null. */
export const priceAt = (prices: DatedPrice[], currency: Currency, at: Date): Price | null => {
	const hit = prices
		.filter((p) => p.currency === currency && new Date(p.effective_from).getTime() <= at.getTime())
		.sort((a, b) => new Date(b.effective_from).getTime() - new Date(a.effective_from).getTime())[0];
	return hit ? { first: hit.first_location_price, additional: hit.additional_location_price } : null;
};

/** first + (n − 1) × additional, for n ≥ 1 locations. */
export const monthlyAmount = (price: Price, quantity: number): number => money(price.first + Math.max(0, Math.max(1, quantity) - 1) * price.additional);

/** Invoice lines for a monthly amount. */
export const monthlyLines = (price: Price, quantity: number): { label: string; quantity: number; unit_price: number; amount: number }[] => {
	const n = Math.max(1, quantity);
	const lines = [{ label: 'First location', quantity: 1, unit_price: price.first, amount: money(price.first) }];
	if (n > 1) lines.push({ label: 'Additional locations', quantity: n - 1, unit_price: price.additional, amount: money((n - 1) * price.additional) });
	return lines;
};

export interface SlotQuoteInput {
	quantity: number;
	/** The additional-location price of the current period. */
	additional: number;
	period_start: Date;
	period_end: Date;
	now: Date;
	/** The renewal amount is already fixed (snapshot taken): the next period must be paid now too. */
	next_period_fixed: boolean;
	/** The additional-location price of the next period (from the snapshot). */
	next_additional?: number;
}

export interface SlotQuote {
	quantity: number;
	remaining_days: number;
	period_days: number;
	lines: { label: string; quantity: number; unit_price: number; amount: number }[];
	amount: number;
}

const DAY = 86_400_000;

/** Prorated charge for extra location slots: the rest of this period (+ the next one when it is already fixed). */
export const slotQuote = (q: SlotQuoteInput): SlotQuote => {
	const total = Math.max(1, q.period_end.getTime() - q.period_start.getTime());
	const left = Math.min(total, Math.max(0, q.period_end.getTime() - q.now.getTime()));
	const fraction = left / total;
	const lines = [
		{
			label: `Additional location${q.quantity === 1 ? '' : 's'}, prorated to ${q.period_end.toISOString().slice(0, 10)}`,
			quantity: q.quantity,
			unit_price: money(q.additional * fraction),
			amount: money(q.additional * fraction * q.quantity),
		},
	];
	if (q.next_period_fixed) {
		const next = q.next_additional ?? q.additional;
		lines.push({ label: `Additional location${q.quantity === 1 ? '' : 's'}, next period (renewal already scheduled)`, quantity: q.quantity, unit_price: money(next), amount: money(next * q.quantity) });
	}
	return {
		quantity: q.quantity,
		remaining_days: Math.round((left / DAY) * 10) / 10,
		period_days: Math.round((total / DAY) * 10) / 10,
		lines,
		amount: money(lines.reduce((s, l) => s + l.amount, 0)),
	};
};

/** Users pooled per organization: users_per_location × paid locations (at least one location). */
export const userLimit = (usersPerLocation: number, paidLocations: number): number => usersPerLocation * Math.max(1, paidLocations);

export interface CouponTerms {
	discount_type: 'percent' | 'fixed';
	value: number;
}

/** A coupon on a pack price: never below zero. */
export const applyCoupon = (price: number, coupon: CouponTerms | null): { price: number; discount: number; total: number } => {
	if (!coupon) return { price: money(price), discount: 0, total: money(price) };
	const raw = coupon.discount_type === 'percent' ? (price * Math.min(100, Math.max(0, coupon.value))) / 100 : coupon.value;
	const discount = money(Math.min(price, Math.max(0, raw)));
	return { price: money(price), discount, total: money(price - discount) };
};

/** A pack's price for an organization: a custom plan price, else the list price minus the plan's discount. */
export const packPrice = (listPrice: number, customPrice: number | null, discountPercent: number): number =>
	money(customPrice ?? listPrice * (1 - Math.min(100, Math.max(0, discountPercent)) / 100));
