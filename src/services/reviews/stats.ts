import { Types } from 'mongoose';
import { GbpReview, Location, ReputationSummary } from '../../models';

// Review numbers (Phase 18): MongoDB aggregation only, never AI. Written to Location.summary.reputation
// after every refresh, sync and reply action, so the dashboard and locations list read one field.

type Id = Types.ObjectId | string;

const monthStart = (now: Date): Date => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

export const reviewStats = async (locationId: Id, now: Date = new Date()): Promise<ReputationSummary> => {
	const id = new Types.ObjectId(String(locationId));
	const since = monthStart(now);
	const [row] = await GbpReview.aggregate<{
		total: number;
		rated: number;
		sum: number;
		new_this_month: number;
		positive: number;
		negative: number;
		unreplied: number;
		awaiting_attention: number;
		flagged: number;
		suspicious: number;
		drafts_pending: number;
		replies_sent_this_month: number;
		last_review_at: Date | null;
	}>([
		{ $match: { location_id: id } },
		{
			$group: {
				_id: null,
				total: { $sum: 1 },
				rated: { $sum: { $cond: [{ $gt: ['$rating', null] }, 1, 0] } },
				sum: { $sum: { $ifNull: ['$rating', 0] } },
				new_this_month: { $sum: { $cond: [{ $gte: ['$create_time', since] }, 1, 0] } },
				positive: { $sum: { $cond: [{ $gte: ['$rating', 4] }, 1, 0] } },
				negative: { $sum: { $cond: [{ $and: [{ $gt: ['$rating', null] }, { $lte: ['$rating', 3] }] }, 1, 0] } },
				unreplied: { $sum: { $cond: [{ $ne: ['$reply_state', 'sent'] }, 1, 0] } },
				awaiting_attention: {
					$sum: {
						$cond: [
							{
								$and: [
									{ $ne: ['$reply_state', 'sent'] },
									{ $or: [{ $and: [{ $gt: ['$rating', null] }, { $lte: ['$rating', 3] }] }, { $ne: ['$flag_level', 'none'] }] },
								],
							},
							1,
							0,
						],
					},
				},
				flagged: { $sum: { $cond: [{ $ne: ['$flag_level', 'none'] }, 1, 0] } },
				suspicious: { $sum: { $cond: [{ $eq: ['$flag_level', 'suspicious'] }, 1, 0] } },
				drafts_pending: { $sum: { $cond: [{ $in: ['$reply_state', ['draft', 'failed']] }, 1, 0] } },
				replies_sent_this_month: { $sum: { $cond: [{ $gte: ['$sent_at', since] }, 1, 0] } },
				last_review_at: { $max: '$create_time' },
			},
		},
	]);
	return {
		total: row?.total ?? 0,
		average_rating: row && row.rated > 0 ? Math.round((row.sum / row.rated) * 10) / 10 : null,
		new_this_month: row?.new_this_month ?? 0,
		positive: row?.positive ?? 0,
		negative: row?.negative ?? 0,
		unreplied: row?.unreplied ?? 0,
		awaiting_attention: row?.awaiting_attention ?? 0,
		flagged: row?.flagged ?? 0,
		suspicious: row?.suspicious ?? 0,
		drafts_pending: row?.drafts_pending ?? 0,
		replies_sent_this_month: row?.replies_sent_this_month ?? 0,
		last_review_at: row?.last_review_at ?? null,
		updated_at: now,
	};
};

/** Recomputes and stores Location.summary.reputation; never throws (a stats hiccup must not fail the action). */
export const updateReviewSummary = async (locationId: Id, now: Date = new Date()): Promise<ReputationSummary | null> => {
	try {
		const stats = await reviewStats(locationId, now);
		await Location.updateOne({ _id: locationId }, { $set: { 'summary.reputation': stats } });
		return stats;
	} catch {
		return null;
	}
};
