import { Types } from 'mongoose';
import httpStatus from 'http-status';
import config from '../../configs/config';
import { PlacesUsage } from '../../models';
import { ApiError } from '../../utils';

// Daily cap on user-triggered (paid) Places calls: competitor suggestions and manual search.
// reserve() increments atomically only while the total stays within the limit; when the per-day
// document exists and is full, the upsert collides on the unique (user_id, day) index instead.

const DAY_MS = 24 * 60 * 60 * 1000;
const DUPLICATE_KEY = 11000;

export const utcDay = (date: Date): string => date.toISOString().slice(0, 10);

export interface PlacesUsageDeps {
	limit?: number;
	now?: () => Date;
}

export const createPlacesUsage = (deps: PlacesUsageDeps = {}) => {
	const limit = (): number => deps.limit ?? config.ranking.userDailyLimit;
	const now = deps.now ?? (() => new Date());

	/** Reserves `calls` for today, or throws 429 when that would exceed the daily limit. */
	const reserve = async (userId: Types.ObjectId | string, calls: number): Promise<void> => {
		const max = limit();
		if (calls > max) {
			throw new ApiError(httpStatus.TOO_MANY_REQUESTS, `Daily search limit reached (${max} per day). Try again tomorrow.`);
		}
		const today = now();
		try {
			const updated = await PlacesUsage.findOneAndUpdate(
				{ user_id: userId, day: utcDay(today), calls: { $lte: max - calls } },
				{ $inc: { calls }, $setOnInsert: { expires_at: new Date(today.getTime() + 2 * DAY_MS) } },
				{ upsert: true, new: true },
			);
			if (updated) return;
		} catch (err) {
			if ((err as { code?: number }).code !== DUPLICATE_KEY) throw err;
		}
		throw new ApiError(httpStatus.TOO_MANY_REQUESTS, `Daily search limit reached (${max} per day). Try again tomorrow.`);
	};

	/** Calls used today. */
	const used = async (userId: Types.ObjectId | string): Promise<number> =>
		(await PlacesUsage.findOne({ user_id: userId, day: utcDay(now()) }).lean())?.calls ?? 0;

	return { reserve, used };
};

export type PlacesUsageService = ReturnType<typeof createPlacesUsage>;
export const placesUsage: PlacesUsageService = createPlacesUsage();
