import { AsyncLocalStorage } from 'async_hooks';
import { NextFunction, Request, Response } from 'express';
import mongoose, { Types } from 'mongoose';
import logger from '../../configs/logger';
import { ApiUsage, UsagePurpose } from '../../models/apiUsage.model';
import { UsageSku } from './skus';

// Usage attribution (Phase 12.5). The Places and GBP clients call recordUsage(sku) for every HTTP
// attempt. Inside withUsage({ organization_id, location_id }, fn) the counts are buffered and written
// in one bulkWrite when fn ends (and on flushUsage(), which long jobs call from their heartbeat).
// Calls outside any scope are written at once as unattributed (organization/location null).

type Id = Types.ObjectId | string;

export interface UsageContext {
	organization_id: Id | null;
	location_id: Id | null;
	/** Phase 19: platform work with no customer (e.g. 'sales_audit'); absent / null = customer work. */
	purpose?: UsagePurpose | null;
}

interface Scope extends UsageContext {
	counts: Map<UsageSku, number>;
}

const storage = new AsyncLocalStorage<Scope>();

export const monthOf = (date: Date): string => date.toISOString().slice(0, 7);

const toId = (id: Id | null): Types.ObjectId | null => (id ? new Types.ObjectId(String(id)) : null);

const write = async (ctx: UsageContext, counts: Map<UsageSku, number>, now: Date): Promise<void> => {
	if (counts.size === 0 || mongoose.connection.readyState !== 1) return;
	const month = monthOf(now);
	const organization_id = toId(ctx.organization_id);
	const location_id = toId(ctx.location_id);
	const purpose = ctx.purpose ?? null;
	await ApiUsage.bulkWrite(
		[...counts.entries()].map(([sku, n]) => ({
			updateOne: {
				filter: { organization_id, location_id, purpose, month, sku },
				update: { $inc: { count: n }, $set: { updated_at: now } },
				upsert: true,
			},
		})),
		{ ordered: false },
	);
};

/** Counts n calls of a SKU against the current scope (or, without one, as unattributed). Never throws. */
export const recordUsage = (sku: UsageSku, n = 1): void => {
	if (n <= 0) return;
	const scope = storage.getStore();
	if (scope) {
		scope.counts.set(sku, (scope.counts.get(sku) ?? 0) + n);
		return;
	}
	write({ organization_id: null, location_id: null }, new Map([[sku, n]]), new Date()).catch((err: Error) =>
		logger.warn(`usage ledger write failed: ${err.message}`),
	);
};

/** Writes the current scope's buffered counts now (long jobs call this from their heartbeat). */
export const flushUsage = async (): Promise<void> => {
	const scope = storage.getStore();
	if (!scope || scope.counts.size === 0) return;
	const counts = new Map(scope.counts);
	scope.counts.clear();
	await write(scope, counts, new Date()).catch((err: Error) => logger.warn(`usage ledger write failed: ${err.message}`));
};

/** Runs fn with Google calls attributed to ctx; the counts are written when it ends (even on error). */
export const withUsage = async <T>(ctx: UsageContext, fn: () => Promise<T>): Promise<T> =>
	storage.run({ ...ctx, counts: new Map() }, async () => {
		try {
			return await fn();
		} finally {
			await flushUsage();
		}
	});

/** The current scope (tests, and nested services that refine the location). */
export const currentUsage = (): UsageContext | null => {
	const s = storage.getStore();
	return s ? { organization_id: s.organization_id, location_id: s.location_id, ...(s.purpose ? { purpose: s.purpose } : {}) } : null;
};

/** Fills in the current scope's organization / location (called by the access helpers once they know them). */
export const setUsageContext = (ctx: Partial<UsageContext>): void => {
	const scope = storage.getStore();
	if (!scope) return;
	if (ctx.organization_id !== undefined && ctx.organization_id !== null) scope.organization_id = ctx.organization_id;
	if (ctx.location_id !== undefined && ctx.location_id !== null) scope.location_id = ctx.location_id;
};

/**
 * Express middleware (mounted on /api/v1): every request gets a usage scope. The organization and
 * location are filled in by loadOrgContext and the location access helpers; the counts are written
 * when the response finishes.
 */
export const usageScope = (req: Request, res: Response, next: NextFunction): void => {
	const scope: Scope = { organization_id: null, location_id: null, counts: new Map() };
	let flushed = false;
	const flush = () => {
		if (flushed) return;
		flushed = true;
		if (scope.counts.size) write(scope, scope.counts, new Date()).catch((err: Error) => logger.warn(`usage ledger write failed: ${err.message}`));
	};
	res.on('finish', flush);
	res.on('close', flush);
	storage.run(scope, () => next());
};
