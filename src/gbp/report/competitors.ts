import { PlaceDetails } from '../../clients/types/places';
import { MAP_LIST_COMPETITORS, MAX_COMPETITORS } from '../scoring.config';
import { CenterRank, PublicScore, centerRank, computePublicScore } from '../score/publicScore';

// Competitor comparison (Phase 7c), pure parts: which businesses to compare, when a business's
// Place Details must be fetched again, and the table rows.

const DAY_MS = 86_400_000;

export interface MapListSection {
	keyword: string;
	results: { rank: number; place_id: string; is_self: boolean }[];
}

export interface CompetitorRef {
	place_id: string;
	source: 'self' | 'tracking' | 'map_list';
}

/** The stored Place Details subset of one business (Places content: kept on the latest report only). */
export interface PlaceFacts {
	name: string | null;
	rating: number | null;
	user_rating_count: number | null;
	primary_type: string | null;
	primary_type_label: string | null;
	has_hours: boolean;
	has_website: boolean;
	has_phone: boolean;
	/** null when the Atmosphere-tier field wasn't requested. */
	has_editorial_summary: boolean | null;
	business_status: string | null;
}

export interface CompetitorRow extends PlaceFacts {
	place_id: string;
	is_self: boolean;
	source: CompetitorRef['source'];
	/** When these facts were fetched; null if never fetched successfully. */
	fetched_at: Date | null;
	/** True when the last fetch failed and older facts (if any) are shown. */
	stale: boolean;
	error: string | null;
	center_rank: CenterRank;
	public_score: PublicScore | null;
}

/**
 * Client first, then tracking.competitors, then the top non-client results of the first keyword's
 * map list; de-duplicated; at most MAX_COMPETITORS besides the client.
 */
export const competitorSet = (selfPlaceId: string | null, tracking: string[], mapList: MapListSection[]): CompetitorRef[] => {
	const out: CompetitorRef[] = [];
	const seen = new Set<string>();
	const push = (placeId: string, source: CompetitorRef['source']) => {
		if (!placeId || seen.has(placeId)) return;
		seen.add(placeId);
		out.push({ place_id: placeId, source });
	};
	if (selfPlaceId) push(selfPlaceId, 'self');
	for (const id of tracking) if (out.length - (selfPlaceId ? 1 : 0) < MAX_COMPETITORS) push(id, 'tracking');
	const first = mapList[0];
	if (first) {
		let added = 0;
		for (const r of [...first.results].sort((a, b) => a.rank - b.rank)) {
			if (added >= MAP_LIST_COMPETITORS || out.length - (selfPlaceId ? 1 : 0) >= MAX_COMPETITORS) break;
			if (r.is_self || seen.has(r.place_id)) continue;
			push(r.place_id, 'map_list');
			added += 1;
		}
	}
	return out;
};

/** Center rank per map-list keyword (null when not in the top 20). The client is matched by is_self. */
export const centerRanksFor = (placeId: string, isSelf: boolean, mapList: MapListSection[]): (number | null)[] =>
	mapList.map((section) => section.results.find((r) => (isSelf ? r.is_self : r.place_id === placeId))?.rank ?? null);

export interface FreshnessInput {
	now: Date;
	/** Start of the current monthly cycle (the last automatic refresh); null if there hasn't been one. */
	cycle_start: Date | null;
	/** Set by a manual refresh; forces a refetch of rows older than 24 h. */
	force_at: Date | null;
}

/** Whether a business's Place Details must be fetched in this generation. */
export const needsFetch = (row: Pick<CompetitorRow, 'fetched_at'> | undefined, f: FreshnessInput): boolean => {
	const fetched = row?.fetched_at ?? null;
	if (!fetched) return true;
	if (f.cycle_start && fetched.getTime() < f.cycle_start.getTime()) return true;
	return Boolean(f.force_at && fetched.getTime() < f.force_at.getTime() && f.now.getTime() - fetched.getTime() >= DAY_MS);
};

export const factsFromDetails = (details: PlaceDetails, withEditorialSummary: boolean): PlaceFacts => ({
	name: details.displayName ?? null,
	rating: details.rating ?? null,
	user_rating_count: details.userRatingCount ?? null,
	primary_type: details.primaryType ?? null,
	primary_type_label: details.primaryTypeDisplayName ?? null,
	has_hours: Boolean(details.regularOpeningHours?.weekdayDescriptions?.length),
	has_website: Boolean(details.websiteUri),
	has_phone: Boolean(details.nationalPhoneNumber),
	has_editorial_summary: withEditorialSummary ? Boolean(details.editorialSummary) : null,
	business_status: details.businessStatus ?? null,
});

export const EMPTY_FACTS: PlaceFacts = {
	name: null,
	rating: null,
	user_rating_count: null,
	primary_type: null,
	primary_type_label: null,
	has_hours: false,
	has_website: false,
	has_phone: false,
	has_editorial_summary: null,
	business_status: null,
};

/** Adds the center ranks and the Public Score to a row (null score while never fetched). */
export const scoreRow = (row: Omit<CompetitorRow, 'center_rank' | 'public_score'>, mapList: MapListSection[]): CompetitorRow => {
	const ranks = centerRanksFor(row.place_id, row.is_self, mapList);
	return {
		...row,
		center_rank: centerRank(ranks),
		public_score: row.fetched_at
			? computePublicScore({
					rating: row.rating,
					user_rating_count: row.user_rating_count,
					primary_type: row.primary_type,
					has_hours: row.has_hours,
					has_website: row.has_website,
					has_phone: row.has_phone,
					has_editorial_summary: row.has_editorial_summary,
					business_status: row.business_status,
					center_ranks: ranks,
				})
			: null,
	};
};
