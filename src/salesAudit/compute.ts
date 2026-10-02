import { normalisePlaceId } from '../clients/placesClient';
import { NamedPlaceEntry, PlaceDetails, PlaceDetailsField } from '../clients/types/places';
import { PublicScore, PublicScorePart, computePublicScore } from '../gbp/score/publicScore';
import { gradeFor } from '../gbp/scoring.config';
import { RankBucket, RankCell } from '../ranking/types';

// Sales audit (Phase 19): the pure part. A quick, public-data-only look at one business for one keyword,
// shown by sales staff in a meeting: a 7×7 heatmap over 5 km, ranks to 30, who ranks higher at the
// business, and the Public Score for the business and the top 3 others. Nothing here touches the network.

export const AUDIT = {
	gridSize: 7,
	radiusKm: 5,
	/** Deepest rank shown; anything deeper is "30+". Two pages of 20 cover it. */
	maxRank: 30,
	pages: 2,
	samples: 1,
	competitors: 3,
	/** An audit still queued or running after this long is marked failed (timed_out). */
	staleAfterMs: 10 * 60 * 1000,
} as const;

/** Place Details for the business and each competitor: the Public Score inputs plus the photo count (Enterprise + Atmosphere SKU). */
export const AUDIT_DETAILS_FIELDS: PlaceDetailsField[] = [
	'id',
	'displayName',
	'formattedAddress',
	'location',
	'addressComponents',
	'rating',
	'userRatingCount',
	'primaryType',
	'primaryTypeDisplayName',
	'regularOpeningHours',
	'websiteUri',
	'nationalPhoneNumber',
	'businessStatus',
	'editorialSummary',
	'photos',
];
export const COMPETITOR_FIELDS: PlaceDetailsField[] = AUDIT_DETAILS_FIELDS.filter((f) => f !== 'addressComponents' && f !== 'location');

export interface AuditCell {
	row: number;
	col: number;
	lat: number;
	lng: number;
	rank: number | null;
	status: RankCell['status'];
}

export interface AuditSummary {
	/** Rank at the business itself (the grid's center point); null when not in the top 30 or failed. */
	center_rank: number | null;
	center_status: RankCell['status'];
	/** Mean over the points that didn't fail, "30+" counted as 31. */
	avg_rank: number | null;
	/** Share of those points where the business is in the top 30 / top 3. */
	found_rate: number | null;
	top3_rate: number | null;
	points: number;
	failed_points: number;
}

/** A rank deeper than 30 becomes "30+" (not_found). */
export const capCell = (cell: RankCell, maxRank: number = AUDIT.maxRank): RankCell =>
	cell.status === 'ok' && cell.rank !== null && cell.rank > maxRank ? { rank: null, status: 'not_found' } : { rank: cell.rank, status: cell.status };

export const auditBucket = (cell: Pick<RankCell, 'rank' | 'status'>): RankBucket => {
	if (cell.status === 'error') return 'error';
	if (cell.status === 'not_found' || cell.rank === null) return 'not_found';
	if (cell.rank <= 3) return 'pack';
	if (cell.rank <= 10) return 'visible';
	if (cell.rank <= 20) return 'low';
	return 'invisible';
};

export const auditRankText = (cell: Pick<RankCell, 'rank' | 'status'>): string =>
	cell.status === 'error' ? '–' : cell.status === 'not_found' || cell.rank === null ? `${AUDIT.maxRank}+` : String(cell.rank);

const round = (v: number, d: number): number => Math.round(v * 10 ** d) / 10 ** d;

export const summarise = (cells: AuditCell[], centerIndex: number): AuditSummary => {
	const usable = cells.filter((c) => c.status !== 'error');
	const center = cells[centerIndex];
	const n = usable.length;
	return {
		center_rank: center?.status === 'ok' ? center.rank : null,
		center_status: center?.status ?? 'error',
		avg_rank: n ? round(usable.reduce((s, c) => s + (c.status === 'ok' && c.rank !== null ? c.rank : AUDIT.maxRank + 1), 0) / n, 1) : null,
		found_rate: n ? round(usable.filter((c) => c.status === 'ok').length / n, 2) : null,
		top3_rate: n ? round(usable.filter((c) => c.status === 'ok' && (c.rank ?? 99) <= 3).length / n, 2) : null,
		points: cells.length,
		failed_points: cells.length - n,
	};
};

const matches = (entry: NamedPlaceEntry, placeId: string): boolean => {
	const target = normalisePlaceId(placeId);
	return normalisePlaceId(entry.id) === target || normalisePlaceId(entry.movedPlaceId) === target;
};

export interface RankedBusiness {
	rank: number;
	place_id: string;
	name: string | null;
	address: string | null;
	is_self: boolean;
}

/**
 * The named list at the business, cut to 30. `higher` holds every business above the client (all 30 when the
 * client isn't in the top 30); `self_rank` is the client's place in that list.
 */
export const rankedAtCenter = (entries: NamedPlaceEntry[], placeId: string): { self_rank: number | null; list: RankedBusiness[]; higher: RankedBusiness[] } => {
	const list = entries.slice(0, AUDIT.maxRank).map((e, i) => ({ rank: i + 1, place_id: e.id, name: e.name, address: e.address ?? null, is_self: matches(e, placeId) }));
	const self = list.find((r) => r.is_self);
	return { self_rank: self?.rank ?? null, list, higher: self ? list.filter((r) => r.rank < self.rank) : list };
};

/** The top N businesses at the business location other than the client (for the score comparison). */
export const topOthers = (list: RankedBusiness[], n: number = AUDIT.competitors): RankedBusiness[] => list.filter((r) => !r.is_self).slice(0, n);

// ---- Public facts and the quick score ----

export interface PublicFacts {
	name: string | null;
	address: string | null;
	rating: number | null;
	user_rating_count: number | null;
	category: string | null;
	has_hours: boolean;
	website: string | null;
	phone: string | null;
	has_editorial_summary: boolean;
	/** Google returns at most 10 photo references: 10 means "10+". */
	photo_count: number | null;
	business_status: string | null;
}

export const factsFrom = (d: PlaceDetails): PublicFacts => ({
	name: d.displayName ?? null,
	address: d.formattedAddress ?? null,
	rating: typeof d.rating === 'number' ? d.rating : null,
	user_rating_count: typeof d.userRatingCount === 'number' ? d.userRatingCount : null,
	category: d.primaryTypeDisplayName ?? d.primaryType ?? null,
	has_hours: Boolean(d.regularOpeningHours?.weekdayDescriptions?.length),
	website: d.websiteUri ?? null,
	phone: d.nationalPhoneNumber ?? null,
	has_editorial_summary: Boolean(d.editorialSummary),
	photo_count: typeof d.photoCount === 'number' ? d.photoCount : null,
	business_status: d.businessStatus ?? null,
});

export interface QuickScore extends PublicScore {
	grade: ReturnType<typeof gradeFor>;
}

export const quickScore = (f: PublicFacts): QuickScore => {
	const s = computePublicScore({
		rating: f.rating,
		user_rating_count: f.user_rating_count,
		primary_type: f.category,
		has_hours: f.has_hours,
		has_website: Boolean(f.website),
		has_phone: Boolean(f.phone),
		has_editorial_summary: f.has_editorial_summary,
		business_status: f.business_status,
	});
	return { ...s, grade: gradeFor(s.score) };
};

export interface CheckItem {
	id: PublicScorePart['id'] | 'photos';
	label: string;
	/** good = full marks, partial = some, missing = none. */
	state: 'good' | 'partial' | 'missing';
	detail: string;
}

const PART_LABELS: Record<PublicScorePart['id'], string> = {
	rating: 'Star rating',
	review_count: 'Number of reviews',
	primary_category: 'Business category',
	hours: 'Opening hours',
	website: 'Website',
	phone: 'Phone number',
	editorial_summary: 'Google description',
};

/** The quick score as a checklist a salesperson can talk through. Photos are informational (not scored). */
export const checklist = (f: PublicFacts, score: QuickScore): CheckItem[] => {
	const detail: Record<PublicScorePart['id'], string> = {
		rating: f.rating === null ? 'No rating yet' : `${f.rating.toFixed(1)} stars`,
		review_count: `${f.user_rating_count ?? 0} reviews`,
		primary_category: f.category ?? 'Not set',
		hours: f.has_hours ? 'Listed' : 'Not listed',
		website: f.website ? 'Listed' : 'Not listed',
		phone: f.phone ? 'Listed' : 'Not listed',
		editorial_summary: f.has_editorial_summary ? 'Shown by Google' : 'None shown',
	};
	const items: CheckItem[] = score.parts.map((p) => ({
		id: p.id,
		label: PART_LABELS[p.id],
		state: p.points >= p.max ? 'good' : p.points > 0 ? 'partial' : 'missing',
		detail: detail[p.id],
	}));
	const photos = f.photo_count ?? 0;
	items.push({ id: 'photos', label: 'Photos', state: photos >= 10 ? 'good' : photos > 0 ? 'partial' : 'missing', detail: photos >= 10 ? '10+ photos' : `${photos} photos` });
	return items;
};

/** ISO country code from the address components ('US' | 'CA'), or null for anything else. */
export const countryOf = (d: PlaceDetails): 'US' | 'CA' | null => {
	const code = d.addressComponents?.find((c) => c.types.includes('country'))?.short?.toUpperCase();
	return code === 'US' || code === 'CA' ? code : null;
};
