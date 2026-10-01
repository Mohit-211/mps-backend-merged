import httpStatus from 'http-status';
import { normalisePlaceId } from '../../clients/placesClient';
import { ILocationTracking, TrackingFrequency } from '../../models/location.model';
import { normaliseKeyword } from '../../ranking/engine';
import {
	GRID_SIZES,
	MAX_RADIUS_KM,
	MAX_SPACING_KM,
	MIN_RADIUS_KM,
	MIN_SPACING_KM,
	isGridSize,
	radiusFromSpacing,
	spacingFromRadius,
} from '../../ranking/points';
import { ApiError, apiErrorWithData } from '../../utils';

// Pure rules for Location.tracking (CLAUDE.md §4 "Keywords"/"Competitors", §9.1, §9.4 validation).

export const MIN_KEYWORD_LENGTH = 2;
export const MAX_KEYWORD_LENGTH = 80;
export const MAX_COMPETITORS = 5;
export const PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{10,255}$/;
export const DEFAULT_GRID_SIZE = 7;
export const DEFAULT_RADIUS_KM = 8;

export interface TrackingUpdate {
	keywords?: string[];
	competitors?: string[];
	/** Phase 17: the radius (center to edge) or the spacing; the other is derived. */
	grid?: { size: number; radius_km?: number; spacing_km?: number };
	frequency?: TrackingFrequency;
}

export const defaultTracking = (): ILocationTracking => ({
	keywords: [],
	keywords_version: 1,
	keywords_updated_at: null,
	competitors: [],
	// Phase 17 (Mohit, 2026-10-01): 7×7 reaching 8 km (~5 mi) from the business.
	grid: { size: DEFAULT_GRID_SIZE, spacing_km: spacingFromRadius(DEFAULT_GRID_SIZE, DEFAULT_RADIUS_KM), radius_km: DEFAULT_RADIUS_KM },
	frequency: 'auto_monthly',
	keyword_groups: [],
	competitor_info: [],
	next_run_at: null,
	last_run_at: null,
	last_error: null,
});

/** Stored tracking (possibly missing or partial) with every default filled in, as a plain object. */
export const withDefaults = (tracking?: Partial<ILocationTracking> | null): ILocationTracking => {
	const base = defaultTracking();
	if (!tracking) return base;
	return {
		keywords: (tracking.keywords ?? []).map((k) => ({ text: k.text, normalized: k.normalized })),
		keywords_version: tracking.keywords_version ?? base.keywords_version,
		keywords_updated_at: tracking.keywords_updated_at ?? null,
		competitors: [...(tracking.competitors ?? [])],
		grid: tracking.grid?.size && tracking.grid.spacing_km
			? {
				size: tracking.grid.size,
				spacing_km: tracking.grid.spacing_km,
				radius_km: tracking.grid.radius_km ?? radiusFromSpacing(tracking.grid.size, tracking.grid.spacing_km),
			}
			: base.grid,
		frequency: tracking.frequency ?? base.frequency,
		keyword_groups: (tracking.keyword_groups ?? []).map((g) => ({ _id: g._id, name: g.name, keywords: [...(g.keywords ?? [])] })),
		competitor_info: (tracking.competitor_info ?? []).map((c) => ({ place_id: c.place_id, name: c.name ?? null, address: c.address ?? null, lat: c.lat ?? null, lng: c.lng ?? null })),
		next_run_at: tracking.next_run_at ?? null,
		last_run_at: tracking.last_run_at ?? null,
		last_error: tracking.last_error ?? null,
	};
};

const invalid = (message: string): ApiError => new ApiError(httpStatus.BAD_REQUEST, message);

/**
 * Phase 17: a grid from its size and either its radius (0.5–15 km) or its spacing; the other is derived.
 * Both must stay in bounds (spacing 0.1–15 km), e.g. a 13×13 needs a radius of at least 0.6 km.
 */
export const resolveGrid = (input: { size: number; radius_km?: number; spacing_km?: number }): ILocationTracking['grid'] => {
	const { size } = input;
	if (!isGridSize(size)) throw apiErrorWithData(httpStatus.BAD_REQUEST, `Grid size must be one of ${GRID_SIZES.join(', ')}`, { reason: 'invalid_grid' });
	let spacing: number;
	let radius: number;
	if (input.radius_km !== undefined) {
		radius = input.radius_km;
		spacing = spacingFromRadius(size, radius);
	} else if (input.spacing_km !== undefined) {
		spacing = input.spacing_km;
		radius = radiusFromSpacing(size, spacing);
	} else {
		throw apiErrorWithData(httpStatus.BAD_REQUEST, 'Give the grid radius_km or spacing_km', { reason: 'invalid_grid' });
	}
	if (!(radius >= MIN_RADIUS_KM && radius <= MAX_RADIUS_KM) || !(spacing >= MIN_SPACING_KM && spacing <= MAX_SPACING_KM)) {
		throw apiErrorWithData(
			httpStatus.BAD_REQUEST,
			`A ${size}×${size} grid needs a radius of ${MIN_RADIUS_KM}–${MAX_RADIUS_KM} km and points ${MIN_SPACING_KM}–${MAX_SPACING_KM} km apart`,
			{ reason: 'invalid_grid', radius_km: radius, spacing_km: spacing },
		);
	}
	return { size, spacing_km: spacing, radius_km: radius };
};

/** Trims, collapses spaces, validates length, de-duplicates on the normalized form (first spelling wins). */
export const normaliseKeywords = (texts: string[], maxKeywords: number): ILocationTracking['keywords'] => {
	const seen = new Set<string>();
	const keywords: ILocationTracking['keywords'] = [];
	for (const raw of texts) {
		const text = String(raw).trim().replace(/\s+/g, ' ');
		if (text.length < MIN_KEYWORD_LENGTH || text.length > MAX_KEYWORD_LENGTH) {
			throw invalid(`Each keyword must be ${MIN_KEYWORD_LENGTH}-${MAX_KEYWORD_LENGTH} characters: "${text}"`);
		}
		const normalized = normaliseKeyword(text);
		if (seen.has(normalized)) continue;
		seen.add(normalized);
		keywords.push({ text, normalized });
	}
	if (keywords.length === 0) throw invalid('At least one keyword is required');
	if (keywords.length > maxKeywords) throw invalid(`At most ${maxKeywords} keywords are allowed`);
	return keywords;
};

/** True when both lists contain the same normalized keywords, ignoring order. */
export const sameKeywordSet = (
	a: { normalized: string }[],
	b: { normalized: string }[],
): boolean => {
	const left = new Set(a.map((k) => k.normalized));
	const right = new Set(b.map((k) => k.normalized));
	return left.size === right.size && [...left].every((k) => right.has(k));
};

/** Competitor place IDs: valid format, de-duplicated, at most 5, never the location's own place_id. */
export const validateCompetitors = (ids: string[], ownPlaceId?: string | null): string[] => {
	const own = normalisePlaceId(ownPlaceId ?? undefined);
	const result: string[] = [];
	for (const raw of ids) {
		const id = normalisePlaceId(String(raw).trim()) ?? '';
		if (!PLACE_ID_PATTERN.test(id)) throw apiErrorWithData(httpStatus.BAD_REQUEST, `Invalid competitor place_id: "${raw}"`, { reason: 'invalid_place_id' });
		if (own && id === own) throw apiErrorWithData(httpStatus.BAD_REQUEST, "A competitor cannot be the location's own place_id", { reason: 'own_place_id' });
		if (!result.includes(id)) result.push(id);
	}
	if (result.length > MAX_COMPETITORS) {
		throw apiErrorWithData(httpStatus.BAD_REQUEST, `At most ${MAX_COMPETITORS} competitors are allowed`, { reason: 'too_many_competitors', limit: MAX_COMPETITORS });
	}
	return result;
};

/**
 * Applies a partial update. Only the fields present change. keywords_version is bumped only when
 * the SET of normalized keywords changes (order-insensitive).
 */
export const applyTrackingUpdate = (
	current: ILocationTracking,
	update: TrackingUpdate,
	ownPlaceId: string | null | undefined,
	now: Date,
	maxKeywords: number,
): { tracking: ILocationTracking; keywordsVersionBumped: boolean } => {
	const tracking = withDefaults(current);
	let keywordsVersionBumped = false;

	if (update.keywords !== undefined) {
		const keywords = normaliseKeywords(update.keywords, maxKeywords);
		if (!sameKeywordSet(keywords, tracking.keywords)) {
			// The first keyword set is version 1; every later change of the set bumps the version.
			const isFirstSet = tracking.keywords.length === 0 && !tracking.keywords_updated_at;
			if (!isFirstSet) {
				tracking.keywords_version += 1;
				keywordsVersionBumped = true;
			}
			tracking.keywords_updated_at = now;
		}
		tracking.keywords = keywords; // spelling/order updates are kept even without a version bump
		// Phase 17: a keyword no longer tracked leaves its groups.
		const kept = new Set(keywords.map((k) => k.normalized));
		tracking.keyword_groups = tracking.keyword_groups.map((g) => ({ ...g, keywords: g.keywords.filter((n) => kept.has(n)) }));
	}

	if (update.competitors !== undefined) {
		tracking.competitors = validateCompetitors(update.competitors, ownPlaceId);
		// Phase 17: details of removed competitors go; new ones are filled by competitorInfo (tracking.service).
		tracking.competitor_info = tracking.competitor_info.filter((c) => tracking.competitors.includes(c.place_id));
	}

	if (update.grid !== undefined) {
		tracking.grid = resolveGrid(update.grid);
	}

	if (update.frequency !== undefined) {
		// auto_monthly: the monthly-refresh scheduler runs it (refresh.next_refresh_at); manual_only: refresh only.
		tracking.frequency = update.frequency;
	}

	return { tracking, keywordsVersionBumped };
};
