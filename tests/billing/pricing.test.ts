import { applyCoupon, money, monthlyAmount, monthlyLines, packPrice, priceAt, slotQuote, userLimit } from '../../src/billing/pricing';

const d = (s: string) => new Date(s);

describe('prices', () => {
	const prices = [
		{ currency: 'USD' as const, first_location_price: 99, additional_location_price: 29, effective_from: d('2026-01-01T00:00:00Z') },
		{ currency: 'USD' as const, first_location_price: 109, additional_location_price: 25, effective_from: d('2026-11-01T00:00:00Z') },
		{ currency: 'CAD' as const, first_location_price: 129, additional_location_price: 39, effective_from: d('2026-01-01T00:00:00Z') },
	];

	it('picks the latest price in effect for the currency (future prices apply from their date)', () => {
		expect(priceAt(prices, 'USD', d('2026-10-15T00:00:00Z'))).toEqual({ first: 99, additional: 29 });
		expect(priceAt(prices, 'USD', d('2026-11-01T00:00:00Z'))).toEqual({ first: 109, additional: 25 });
		expect(priceAt(prices, 'CAD', d('2026-12-01T00:00:00Z'))).toEqual({ first: 129, additional: 39 });
		expect(priceAt(prices, 'USD', d('2025-12-31T00:00:00Z'))).toBeNull();
		expect(priceAt([], 'USD', d('2026-12-01T00:00:00Z'))).toBeNull();
	});

	it('monthly = first + (n − 1) × additional', () => {
		const p = { first: 99, additional: 29 };
		expect([1, 2, 5, 20].map((n) => monthlyAmount(p, n))).toEqual([99, 128, 215, 650]);
		expect(monthlyAmount(p, 0)).toBe(99); // at least one location is billed
		expect(monthlyLines(p, 3)).toEqual([
			{ label: 'First location', quantity: 1, unit_price: 99, amount: 99 },
			{ label: 'Additional locations', quantity: 2, unit_price: 29, amount: 58 },
		]);
		expect(monthlyLines(p, 1)).toHaveLength(1);
	});
});

describe('prorated slots', () => {
	const period = { period_start: d('2026-10-01T00:00:00Z'), period_end: d('2026-10-31T00:00:00Z') };

	it('charges the additional price for the rest of the period', () => {
		const q = slotQuote({ ...period, quantity: 1, additional: 30, now: d('2026-10-16T00:00:00Z'), next_period_fixed: false });
		expect(q).toMatchObject({ quantity: 1, remaining_days: 15, period_days: 30, amount: 15 });
		expect(slotQuote({ ...period, quantity: 2, additional: 29, now: d('2026-10-21T00:00:00Z'), next_period_fixed: false }).amount).toBe(19.33);
		expect(slotQuote({ ...period, quantity: 1, additional: 30, now: d('2026-11-05T00:00:00Z'), next_period_fixed: false }).amount).toBe(0);
	});

	it('adds the next period when the renewal amount is already fixed (snapshot taken)', () => {
		const q = slotQuote({ ...period, quantity: 1, additional: 30, next_additional: 25, now: d('2026-10-25T00:00:00Z'), next_period_fixed: true });
		expect(q.lines).toHaveLength(2);
		expect(q.amount).toBe(money(30 * (6 / 30) + 25));
	});
});

describe('users, packs and coupons', () => {
	it('pools users per paid location (at least one)', () => {
		expect([userLimit(3, 1), userLimit(3, 4), userLimit(3, 0)]).toEqual([3, 12, 3]);
	});

	it('pack price: custom price wins, else the discount; coupons never go below zero', () => {
		expect(packPrice(50, null, 0)).toBe(50);
		expect(packPrice(50, null, 20)).toBe(40);
		expect(packPrice(50, 35, 20)).toBe(35);
		expect(applyCoupon(40, { discount_type: 'percent', value: 25 })).toEqual({ price: 40, discount: 10, total: 30 });
		expect(applyCoupon(40, { discount_type: 'fixed', value: 55 })).toEqual({ price: 40, discount: 40, total: 0 });
		expect(applyCoupon(40, null)).toEqual({ price: 40, discount: 0, total: 40 });
	});
});
