import { CompetitorsSection, LeanRankRun } from '../../../models';
import { CompetitorData } from '../types';

// Competitor Analysis report data (Phase 12): the comparison rows and insights of the stored GBP
// report (7c) joined with the latest rank run's overall rank per tracked target. Names only: place
// ids are not copied into the snapshot.

type Section = 'public_scores' | 'table' | 'ranks' | 'insights' | 'reviews';

const REVIEWS_PER_BUSINESS = 2;

export type RunForCompetitors = Pick<LeanRankRun, 'targets' | 'overall' | 'tracker'>;

const round2 = (v: number): number => Math.round(v * 100) / 100;

const top3Of = (run: RunForCompetitors, key: string): number | null => {
	const values = (run.tracker ?? []).map((t) => t.summary?.[key]?.top3Rate).filter((v): v is number => typeof v === 'number');
	return values.length ? round2(values.reduce((s, v) => s + v, 0) / values.length) : null;
};

export const buildCompetitorData = (section: CompetitorsSection, run: RunForCompetitors | null, sections: readonly string[]): CompetitorData => {
	const want = (s: Section) => sections.includes(s);
	const rows = section.rows;
	const nameOf = (r: (typeof rows)[number]) => r.name ?? (r.is_self ? 'Your business' : 'Unnamed business');
	const data: CompetitorData = { available: true, generated_at: section.generated_at };

	if (want('public_scores')) {
		data.public_scores = rows
			.map((r) => ({ name: nameOf(r), is_self: r.is_self, score: r.public_score?.score ?? null, flag: r.public_score?.flag ?? null }))
			.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
	}
	if (want('table')) {
		data.table = rows.map((r) => ({
			name: nameOf(r),
			is_self: r.is_self,
			rating: r.rating,
			reviews: r.user_rating_count,
			category: r.primary_type_label ?? r.primary_type,
			has_hours: r.has_hours,
			has_website: r.has_website,
			has_phone: r.has_phone,
			status: r.business_status,
			photos: r.photo_count ?? null,
			photos_capped: r.photos_capped ?? false,
		}));
	}
	if (want('ranks')) {
		const keyByPlace = new Map((run?.targets ?? []).map((t) => [t.place_id, t.key]));
		data.ranks = rows.map((r) => {
			const key = r.is_self ? 'self' : keyByPlace.get(r.place_id);
			return {
				name: nameOf(r),
				is_self: r.is_self,
				overall_avg_rank: run && key ? run.overall?.[key]?.overallAvgRank ?? null : null,
				top3_rate: run && key ? top3Of(run, key) : null,
				center_avg: r.center_rank?.avg ?? null,
				center_top3_rate: r.center_rank?.top3_rate ?? null,
			};
		});
	}
	if (want('insights')) data.insights = section.insights.map((i) => i.message);
	if (want('reviews')) {
		data.reviews = rows
			.filter((r) => (r.reviews ?? []).length > 0)
			.map((r) => ({
				name: nameOf(r),
				is_self: r.is_self,
				items: [...(r.reviews ?? [])]
					.sort((a, b) => (b.publish_time ? new Date(b.publish_time).getTime() : 0) - (a.publish_time ? new Date(a.publish_time).getTime() : 0))
					.slice(0, REVIEWS_PER_BUSINESS)
					.map((v) => ({ rating: v.rating, text: v.text, when: v.relative_time, author: v.author.name, author_uri: v.author.uri })),
			}));
	}
	return data;
};
