import httpStatus from 'http-status';
import { DateTime } from 'luxon';
import { normalisePlaceId } from '../../clients/placesClient';
import { ILocationTracking, TrackingFrequency } from '../../models/location.model';
import { normaliseKeyword } from '../../ranking/engine';
import { ApiError } from '../../utils';

// Pure rules for Location.tracking (CLAUDE.md §4 "Keywords"/"Competitors", §9.1, §9.4 validation).

export const MIN_KEYWORD_LENGTH = 2;
export const MAX_KEYWORD_LENGTH = 80;
export const MAX_COMPETITORS = 5;
export const PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{10,255}$/;

export interface TrackingUpdate {
	keywords?: string[];
	competitors?: string[];
	grid?: { size: number; spacing_km: number };
	frequency?: TrackingFrequency;
	next_run_at?: Date | null;
}

export const defaultTracking = (): ILocationTracking => ({
	keywords: [],
	keywords_version: 1,
	keywords_updated_at: null,
	competitors: [],
	grid: { size: 5, spacing_km: 1 },
	frequency: 'manual',
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
		grid: {
			size: tracking.grid?.size ?? base.grid.size,
			spacing_km: tracking.grid?.spacing_km ?? base.grid.spacing_km,
		},
		frequency: tracking.frequency ?? base.frequency,
		next_run_at: tracking.next_run_at ?? null,
		last_run_at: tracking.last_run_at ?? null,
		last_error: tracking.last_error ?? null,
	};
};

const invalid = (message: string): ApiError => new ApiError(httpStatus.BAD_REQUEST, message);

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
		if (!PLACE_ID_PATTERN.test(id)) throw invalid(`Invalid competitor place_id: "${raw}"`);
		if (own && id === own) throw invalid("A competitor cannot be the location's own place_id");
		if (!result.includes(id)) result.push(id);
	}
	if (result.length > MAX_COMPETITORS) throw invalid(`At most ${MAX_COMPETITORS} competitors are allowed`);
	return result;
};

/** Next scheduled run after `from`, stepping by the frequency until it is after `now` (no catch-up bursts). */
export const nextRunAfter = (frequency: Exclude<TrackingFrequency, 'manual'>, from: Date, now: Date): Date => {
	let next = DateTime.fromJSDate(from);
	const step = frequency === 'weekly' ? { weeks: 1 } : { months: 1 };
	do {
		next = next.plus(step);
	} while (next.toMillis() <= now.getTime());
	return next.toJSDate();
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
	}

	if (update.competitors !== undefined) {
		tracking.competitors = validateCompetitors(update.competitors, ownPlaceId);
	}

	if (update.grid !== undefined) {
		tracking.grid = { size: update.grid.size, spacing_km: update.grid.spacing_km };
	}

	if (update.frequency !== undefined || update.next_run_at !== undefined) {
		const frequency = update.frequency ?? tracking.frequency;
		if (frequency === 'manual') {
			if (update.next_run_at) throw invalid('next_run_at requires a weekly or monthly frequency');
			tracking.next_run_at = null;
		} else if (update.next_run_at) {
			tracking.next_run_at = update.next_run_at;
		} else if (update.frequency !== undefined && (update.frequency !== tracking.frequency || !tracking.next_run_at)) {
			tracking.next_run_at = now; // picked up by the next scheduler tick
		}
		tracking.frequency = frequency;
	}

	return { tracking, keywordsVersionBumped };
};
