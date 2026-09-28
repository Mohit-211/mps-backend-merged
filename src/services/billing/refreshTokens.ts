import { Types } from 'mongoose';
import logger from '../../configs/logger';
import { GbpSync, RankRun, RefreshType } from '../../models';
import { refundSpend } from './tokens';

// Tokens for manual refreshes (Phase 13a). A spend is linked to what it paid for (the rank run or GBP
// sync id); when that fails entirely the spend is refunded, once.

type Id = Types.ObjectId | string;

export const refreshRef = (type: RefreshType, id: Id): string => `${type === 'rankings' ? 'rank_run' : 'gbp_sync'}:${String(id)}`;

/** Refunds a failed refresh's tokens (no-op without a spend). Never throws. */
export const refundFailedRefresh = async (type: RefreshType, id: Id, reason: string): Promise<number> => {
	try {
		return await refundSpend(refreshRef(type, id), `Refund: ${type} refresh failed (${reason.slice(0, 120)})`);
	} catch (err) {
		logger.error(`billing: token refund for ${refreshRef(type, id)} failed: ${(err as Error).message}`);
		return 0;
	}
};

/** After a stuck guard: refunds those of `ids` that really ended failed. */
export const refundFailedAmong = async (type: RefreshType, ids: Id[]): Promise<number> => {
	if (ids.length === 0) return 0;
	const model = type === 'rankings' ? RankRun : GbpSync;
	const failed = await (model as typeof RankRun).find({ _id: { $in: ids }, status: 'failed' }).select({ _id: 1, failure_reason: 1 }).lean<{ _id: Types.ObjectId; failure_reason?: string | null }[]>();
	let total = 0;
	for (const f of failed) total += await refundFailedRefresh(type, f._id, f.failure_reason ?? 'failed');
	return total;
};
