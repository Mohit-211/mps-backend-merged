import { Types } from 'mongoose';
import { GbpReview, IGbpReview, ReviewInsight } from '../../../models';
import { FLAG_CODES } from '../../../reviews/flags';
import { reviewStats } from '../../reviews/stats';
import { Part, ReputationReportData } from '../types';

// Reputation Report data (2026-10-02): built from stored reviews and the stored insights only. Generating a
// report never calls Google or OpenAI; insights appear only if someone generated them in the app.

type Section = 'summary' | 'distribution' | 'needs_attention' | 'replies_sent' | 'insights';

const ATTENTION_ROWS = 10;
const RECENT_REPLIES = 5;
const EXCERPT = 220;
const DAY = 86_400_000;

const excerpt = (t: string | null | undefined): string | null => (t ? (t.length > EXCERPT ? `${t.slice(0, EXCERPT - 1)}…` : t) : null);

export const buildReputationData = async (locationId: Types.ObjectId, sections: readonly string[], now: Date): Promise<Part<ReputationReportData>> => {
	const want = (s: Section) => sections.includes(s);
	const total = await GbpReview.countDocuments({ location_id: locationId });
	if (!total) return { available: false, reason: 'no_reviews' };
	const data: ReputationReportData = { available: true, as_of: now };
	const stats = await reviewStats(locationId, now);
	if (want('summary')) {
		const replied = total - stats.unreplied;
		data.summary = {
			average_rating: stats.average_rating,
			total: stats.total,
			new_this_month: stats.new_this_month,
			positive: stats.positive,
			negative: stats.negative,
			reply_rate: total ? Math.round((replied / total) * 100) / 100 : null,
			awaiting_attention: stats.awaiting_attention,
			flagged: stats.flagged,
		};
	}
	if (want('distribution')) {
		const rows = await GbpReview.aggregate<{ _id: number | null; n: number }>([{ $match: { location_id: locationId } }, { $group: { _id: '$rating', n: { $sum: 1 } } }]);
		data.distribution = [5, 4, 3, 2, 1].map((stars) => ({ stars, count: rows.find((r) => r._id === stars)?.n ?? 0 }));
	}
	if (want('needs_attention')) {
		const rows = await GbpReview.find({
			location_id: locationId,
			reply_state: { $ne: 'sent' },
			$or: [{ rating: { $lte: 3 } }, { flag_level: { $ne: 'none' } }],
		})
			.sort({ create_time: -1 })
			.limit(ATTENTION_ROWS)
			.lean<IGbpReview[]>();
		data.needs_attention = rows.map((r) => ({
			rating: r.rating,
			date: r.create_time,
			excerpt: excerpt(r.comment),
			flags: (r.flags ?? []).map((f) => FLAG_CODES[f.code]?.label ?? f.code),
			flag_level: r.flag_level ?? 'none',
		}));
	}
	if (want('replies_sent')) {
		const since90 = new Date(now.getTime() - 90 * DAY);
		const [last90, recent] = await Promise.all([
			GbpReview.countDocuments({ location_id: locationId, sent_at: { $gte: since90 } }),
			GbpReview.find({ location_id: locationId, reply: { $ne: null } }).sort({ 'reply.update_time': -1 }).limit(RECENT_REPLIES).lean<IGbpReview[]>(),
		]);
		data.replies_sent = {
			this_month: stats.replies_sent_this_month,
			last_90_days: last90,
			recent: recent.map((r) => ({ rating: r.rating, review: excerpt(r.comment), reply: excerpt(r.reply?.comment), date: r.reply?.update_time ?? null })),
		};
	}
	if (want('insights')) {
		const doc = await ReviewInsight.findOne({ location_id: locationId }).lean();
		data.insights = doc
			? { available: true as const, generated_at: doc.generated_at, themes: doc.insight.themes ?? [], praise: doc.insight.praise ?? [], complaints: doc.insight.complaints ?? [], observations: doc.insight.observations ?? [] }
			: { available: false, reason: 'no_insights' };
	}
	return data;
};
