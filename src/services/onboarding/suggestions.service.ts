import { Types } from 'mongoose';
import httpStatus from 'http-status';
import logger from '../../configs/logger';
import { PlacesApiError, PlacesClient, PlacesConfigError, placesClient } from '../../clients/placesClient';
import { SuggestionPlace } from '../../clients/types/places';
import { CompetitorSuggestion, ILocation, Location } from '../../models';
import { applyDevKeywordCap } from '../../ranking/limits';
import { regionFromCountry } from '../../ranking/region';
import { ApiError } from '../../utils';
import { withDefaults } from '../ranking/trackingSettings';
import { PlacesUsageService, placesUsage } from './usage';

// Competitor suggestions for onboarding (Phase 7a): one Text Search per tracking keyword at the
// location's center (Enterprise SKU: rating + userRatingCount), merged, de-duplicated, self excluded,
// ranked by best position across keywords, top 10. Cached on the location for 24 h per keyword set.

export const SUGGESTIONS_LIMIT = 10;
export const SUGGESTIONS_CACHE_MS = 24 * 60 * 60 * 1000;

export interface KeywordResults {
	keyword: string;
	places: SuggestionPlace[];
}

/** Pure merge: best position per business across keywords; self (id or movedPlaceId) excluded. */
export const mergeSuggestions = (lists: KeywordResults[], selfPlaceId: string | null, limit = SUGGESTIONS_LIMIT): CompetitorSuggestion[] => {
	const byId = new Map<string, CompetitorSuggestion>();
	for (const { keyword, places } of lists) {
		places.forEach((place, index) => {
			if (selfPlaceId && (place.id === selfPlaceId || place.movedPlaceId === selfPlaceId)) return;
			const id = place.movedPlaceId ?? place.id; // a moved listing counts as its current place
			const position = index + 1;
			const existing = byId.get(id);
			if (!existing) {
				byId.set(id, {
					place_id: id,
					name: place.name,
					address: place.address,
					rating: place.rating,
					userRatingCount: place.userRatingCount,
					best_position: position,
					keywords: [{ keyword, position }],
				});
				return;
			}
			if (!existing.keywords.some((k) => k.keyword === keyword)) existing.keywords.push({ keyword, position });
			existing.best_position = Math.min(existing.best_position, position);
			existing.name ??= place.name;
			existing.address ??= place.address;
			existing.rating ??= place.rating;
			existing.userRatingCount ??= place.userRatingCount;
		});
	}
	return [...byId.values()]
		.sort(
			(a, b) =>
				a.best_position - b.best_position ||
				b.keywords.length - a.keywords.length ||
				(b.userRatingCount ?? 0) - (a.userRatingCount ?? 0),
		)
		.slice(0, limit);
};

export interface SuggestionsView {
	generated_at: Date;
	cached: boolean;
	keywords_used: string[];
	api_calls: number;
	suggestions: (CompetitorSuggestion & { already_selected: boolean })[];
}

export interface SuggestionsDeps {
	places?: Pick<PlacesClient, 'searchTextForSuggestions'>;
	usage?: Pick<PlacesUsageService, 'reserve'>;
	now?: () => Date;
	env?: string;
}

export const createSuggestionsService = (deps: SuggestionsDeps = {}) => {
	const places = deps.places ?? placesClient;
	const usage = deps.usage ?? placesUsage;
	const now = deps.now ?? (() => new Date());

	const view = (
		data: { generated_at: Date; keywords_used: string[]; api_calls: number; results: CompetitorSuggestion[] },
		cached: boolean,
		selected: string[],
	): SuggestionsView => ({
		generated_at: data.generated_at,
		cached,
		keywords_used: data.keywords_used,
		api_calls: cached ? 0 : data.api_calls,
		suggestions: data.results.map((s) => ({ ...s, keywords: s.keywords.map((k) => ({ keyword: k.keyword, position: k.position })), already_selected: selected.includes(s.place_id) })),
	});

	const getSuggestions = async (location: ILocation, userId: Types.ObjectId | string, options: { refresh?: boolean } = {}): Promise<SuggestionsView> => {
		const tracking = withDefaults(location.tracking);
		if (tracking.keywords.length === 0) throw new ApiError(httpStatus.BAD_REQUEST, 'Add at least one keyword first.');
		if (typeof location.lat !== 'number' || typeof location.lng !== 'number') {
			throw new ApiError(httpStatus.BAD_REQUEST, 'This location has no coordinates yet.');
		}
		const cachedData = location.competitor_suggestions;
		const fresh =
			cachedData &&
			cachedData.keywords_version === tracking.keywords_version &&
			now().getTime() - new Date(cachedData.generated_at).getTime() < SUGGESTIONS_CACHE_MS;
		if (fresh && !options.refresh) return view(cachedData, true, tracking.competitors);

		let region: string;
		try {
			region = regionFromCountry(location.country);
		} catch (err) {
			throw new ApiError(httpStatus.BAD_REQUEST, (err as Error).message);
		}
		const keywords = applyDevKeywordCap(tracking.keywords.map((k) => k.text), deps.env).keywords;
		await usage.reserve(userId, keywords.length);

		const lists: KeywordResults[] = [];
		let apiCalls = 0;
		let failures = 0;
		for (const keyword of keywords) {
			try {
				const result = await places.searchTextForSuggestions({
					textQuery: keyword,
					regionCode: region,
					center: { latitude: location.lat, longitude: location.lng },
				});
				apiCalls += result.apiCalls;
				lists.push({ keyword, places: result.places });
			} catch (err) {
				if (err instanceof PlacesConfigError) throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Places search is not configured on this server.');
				if (!(err instanceof PlacesApiError)) throw err;
				apiCalls += err.apiCalls;
				failures += 1;
				logger.warn(`competitor suggestions: search failed for one keyword (status=${err.status ?? '-'})`);
			}
		}
		if (failures === keywords.length) throw new ApiError(httpStatus.BAD_GATEWAY, 'Google Places search failed. Try again later.');

		const data = {
			generated_at: now(),
			keywords_version: tracking.keywords_version,
			keywords_used: keywords,
			api_calls: apiCalls,
			results: mergeSuggestions(lists, location.place_id || null),
		};
		await Location.updateOne({ _id: location._id }, { $set: { competitor_suggestions: data } });
		logger.info(`competitor suggestions: location ${String(location._id)} keywords=${keywords.length} calls=${apiCalls}`);
		return view(data, false, tracking.competitors);
	};

	return { getSuggestions };
};

export const suggestionsService = createSuggestionsService();
