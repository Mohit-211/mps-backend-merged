import { CompetitorsSection } from '../../../models';
import { CompetitorData } from '../types';

// Competitor Analysis report data (Phase 12): the comparison rows and insights of the stored GBP
// report (7c). Names only: place ids are not copied into the snapshot. 2026-10-02: no ranking data
// (the 'ranks' section was removed; competitor ranks are on the ranking pages and in the Rank Tracker report).

type Section = 'public_scores' | 'table' | 'insights' | 'reviews';

const REVIEWS_PER_BUSINESS = 2;

export const buildCompetitorData = (section: CompetitorsSection, sections: readonly string[]): CompetitorData => {
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
