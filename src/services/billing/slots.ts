import { Currency, currencyFor } from '../../billing/constants';
import { slotQuote, SlotQuote } from '../../billing/pricing';
import { LoadedEntitlement } from './entitlement.service';

// Prorated location slots (Phase 13a): extra locations beyond the paid quantity, charged at the
// additional-location price for the rest of the current period (plus the next period when its renewal
// amount is already fixed by the snapshot).

export interface SlotQuoteResult extends SlotQuote {
	currency: Currency;
	period_end: Date;
	billing_method: 'paypal' | 'manual';
	paid_quantity: number;
	new_paid_quantity: number;
}

export const quoteSlots = (loaded: LoadedEntitlement, quantity: number, now: Date = new Date()): SlotQuoteResult | null => {
	const s = loaded.subscription;
	if (!s || !s.current_period_start || !s.current_period_end) return null;
	const nextFixed = Boolean(s.next_renewal && s.next_renewal.period_end && s.next_renewal.period_end.getTime() === s.current_period_end.getTime());
	const q = slotQuote({
		quantity,
		additional: s.price.additional,
		period_start: s.current_period_start,
		period_end: s.current_period_end,
		now,
		next_period_fixed: nextFixed,
		next_additional: s.next_renewal?.price?.additional,
	});
	return {
		...q,
		currency: s.currency ?? currencyFor(loaded.organization.country),
		period_end: s.current_period_end,
		billing_method: s.billing_method,
		paid_quantity: s.paid_quantity,
		new_paid_quantity: s.paid_quantity + quantity,
	};
};
