import { Types } from 'mongoose';
import { DEFAULT_PRICING, Pricing } from '../../configs/pricing';
import { ApiUsage } from '../../models/apiUsage.model';
import { monthOf } from './scope';
import { UsageSku } from './skus';

// Usage and cost figures from the ledger (Phase 12.5). Cost is counts × list price; Google's free
// monthly allowances apply per Cloud project, so they are subtracted only in the project-wide total.

type Id = Types.ObjectId | string;

const round2 = (v: number): number => Math.round(v * 100) / 100;

export const costOf = (bySku: Partial<Record<string, number>>, pricing: Pricing = DEFAULT_PRICING): number =>
	round2(Object.entries(bySku).reduce((sum, [sku, n]) => sum + ((n ?? 0) / 1000) * (pricing.prices_per_1000[sku as UsageSku] ?? 0), 0));

/** Project-wide cost after subtracting each SKU's free monthly allowance. */
export const costAfterFreeTier = (bySku: Partial<Record<string, number>>, pricing: Pricing = DEFAULT_PRICING): number =>
	round2(
		Object.entries(bySku).reduce((sum, [sku, n]) => {
			const billable = Math.max(0, (n ?? 0) - (pricing.free_per_month[sku as UsageSku] ?? 0));
			return sum + (billable / 1000) * (pricing.prices_per_1000[sku as UsageSku] ?? 0);
		}, 0),
	);

export const previousMonth = (month: string): string => {
	const [y, m] = month.split('-').map(Number);
	return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

const bySkuFor = async (filter: Record<string, unknown>): Promise<Record<string, number>> => {
	const rows = await ApiUsage.aggregate<{ _id: string; count: number }>([{ $match: filter }, { $group: { _id: '$sku', count: { $sum: '$count' } } }]);
	return Object.fromEntries(rows.sort((a, b) => a._id.localeCompare(b._id)).map((r) => [r._id, r.count]));
};

/** An organization's Google API usage this month and last month (all its locations), for GET /organization/usage. */
export const organizationApiUsage = async (organizationId: Id, now: Date = new Date(), pricing: Pricing = DEFAULT_PRICING) => {
	const month = monthOf(now);
	const prev = previousMonth(month);
	const orgId = new Types.ObjectId(String(organizationId));
	const [current, last] = await Promise.all([bySkuFor({ organization_id: orgId, month }), bySkuFor({ organization_id: orgId, month: prev })]);
	return {
		month,
		by_sku: current,
		estimated_cost_usd: costOf(current, pricing),
		previous_month: { month: prev, by_sku: last, estimated_cost_usd: costOf(last, pricing) },
		note: 'Counts of Google API calls; cost at list prices before Google’s free monthly allowances.',
	};
};

export interface CostReportRow {
	organization_id: string | null;
	location_id: string | null;
	by_sku: Record<string, number>;
	cost_usd: number;
}

/** Per organization and location for one month (cost:report). */
export const costReport = async (month: string, opts: { organizationId?: Id; pricing?: Pricing } = {}) => {
	const pricing = opts.pricing ?? DEFAULT_PRICING;
	const match: Record<string, unknown> = { month, ...(opts.organizationId ? { organization_id: new Types.ObjectId(String(opts.organizationId)) } : {}) };
	const rows = await ApiUsage.aggregate<{ _id: { o: Types.ObjectId | null; l: Types.ObjectId | null }; skus: { sku: string; count: number }[] }>([
		{ $match: match },
		{ $group: { _id: { o: '$organization_id', l: '$location_id', sku: '$sku' }, count: { $sum: '$count' } } },
		{ $group: { _id: { o: '$_id.o', l: '$_id.l' }, skus: { $push: { sku: '$_id.sku', count: '$count' } } } },
	]);
	const out: CostReportRow[] = rows.map((r) => {
		const bySku = Object.fromEntries(r.skus.sort((a, b) => a.sku.localeCompare(b.sku)).map((s) => [s.sku, s.count]));
		return { organization_id: r._id.o ? String(r._id.o) : null, location_id: r._id.l ? String(r._id.l) : null, by_sku: bySku, cost_usd: costOf(bySku, pricing) };
	});
	out.sort((a, b) => b.cost_usd - a.cost_usd || String(a.organization_id).localeCompare(String(b.organization_id)) || String(a.location_id).localeCompare(String(b.location_id)));
	const totals: Record<string, number> = {};
	for (const r of out) for (const [sku, n] of Object.entries(r.by_sku)) totals[sku] = (totals[sku] ?? 0) + n;
	return { month, rows: out, totals, cost_usd: costOf(totals, pricing), cost_after_free_tier_usd: costAfterFreeTier(totals, pricing), pricing_source: pricing.source };
};
