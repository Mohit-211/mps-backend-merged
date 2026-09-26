import config from '../configs/config';
import logger from '../configs/logger';
import {
	HttpRequest,
	HttpRequestError,
	HttpTransport,
	Sleep,
	createAxiosTransport,
	defaultSleep,
	isTransportError,
	toHttpRequestError,
	withRetry,
} from './http';
import {
	LatLng,
	NamedPlaceEntry,
	PlaceDetails,
	PlaceDetailsField,
	PlaceDetailsResult,
	PlaceIdEntry,
	NameAddressPlace,
	PlacesCallStats,
	SearchTextNamesAddressesResult,
	SearchTextSuggestionsResult,
	SuggestionPlace,
	RawPlaceDetails,
	RawSearchTextResponse,
	SearchTextIdsParams,
	SearchTextIdsResult,
	SearchTextParams,
	SearchTextWithNamesResult,
} from './types/places';

// Places API (New) client. Every call goes through withRetry (15 s timeout, 1 retry).
// The API key is sent only in the X-Goog-Api-Key header and never logged or put in errors.

const BASE_URL = 'https://places.googleapis.com/v1';
const PAGE_SIZE = 20;
export const MAX_PAGES = 3;

/** The only fields allowed for searchTextIds: keeps it on the free "Text Search Essentials (IDs Only)" SKU. */
export const IDS_ONLY_FIELDS: readonly string[] = ['places.id', 'places.movedPlaceId', 'nextPageToken'];
export const IDS_ONLY_FIELD_MASK = IDS_ONLY_FIELDS.join(',');
/** Adds displayName, which bills the call as Text Search Pro. Used only for Map Ranking. */
export const WITH_NAMES_FIELD_MASK = 'places.id,places.movedPlaceId,places.displayName,nextPageToken';
/** Competitor suggestions: rating + userRatingCount bill the call as Text Search Enterprise. 1 page. */
export const SUGGESTIONS_FIELD_MASK =
	'places.id,places.movedPlaceId,places.displayName,places.formattedAddress,places.rating,places.userRatingCount';
/** Manual competitor search: names and addresses only (Text Search Pro). */
export const NAMES_ADDRESSES_FIELD_MASK = 'places.id,places.displayName,places.formattedAddress';
export const MANUAL_SEARCH_PAGE_SIZE = 10;

/** Throws unless `mask` is exactly `expected` (same fields, no extras): each search keeps its SKU. */
export const assertExactMask = (mask: string, expected: string): void => {
	const fields = mask.split(',').map((f) => f.trim());
	const allowed = expected.split(',');
	const valid = fields.length === allowed.length && new Set(fields).size === fields.length && fields.every((f) => allowed.includes(f));
	if (!valid) throw new Error(`Field mask violated: "${mask}" (expected ${expected}).`);
};

export class PlacesConfigError extends Error {
	constructor(message = 'GOOGLE_PLACE_API_KEY not set') {
		super(message);
		this.name = 'PlacesConfigError';
	}
}

export class PlacesApiError extends Error {
	readonly status?: number;
	readonly apiStatus?: string;
	readonly code: HttpRequestError['code'];
	/** HTTP calls made by the failed operation (all pages and retries). */
	readonly apiCalls: number;

	constructor(cause: HttpRequestError, apiCalls: number) {
		super(`Places API request failed: ${cause.message}`);
		this.name = 'PlacesApiError';
		this.status = cause.status;
		this.apiStatus = cause.apiStatus;
		this.code = cause.code;
		this.apiCalls = apiCalls;
	}
}

/** Throws unless the mask is exactly the IDs-only field set. */
export const assertIdsOnlyMask = (mask: string): void => {
	const fields = mask.split(',').map((f) => f.trim());
	const allowed = new Set(IDS_ONLY_FIELDS);
	const valid =
		fields.length === allowed.size &&
		new Set(fields).size === fields.length &&
		fields.every((f) => allowed.has(f));
	if (!valid) {
		throw new Error(
			`IDs-only field mask violated: "${mask}". searchTextIds may request only ${IDS_ONLY_FIELD_MASK}.`,
		);
	}
};

/** Accepts "ChIJ…" or "places/ChIJ…" and returns the bare place ID. */
export const normalisePlaceId = (value: string | undefined): string | undefined =>
	value ? value.replace(/^places\//, '') : undefined;

const assertSearchParams = (params: SearchTextParams): void => {
	if (!params.textQuery || !params.textQuery.trim()) throw new Error('textQuery is required');
	if (!/^[a-z]{2}$/i.test(params.regionCode)) throw new Error(`Invalid regionCode "${params.regionCode}"`);
	if (!params.center) return;
	const { latitude, longitude } = params.center;
	if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
		throw new Error('center must be a valid latitude/longitude');
	}
};

const toLatLng = (raw: RawPlaceDetails['location']): LatLng | undefined =>
	raw && typeof raw.latitude === 'number' && typeof raw.longitude === 'number'
		? { latitude: raw.latitude, longitude: raw.longitude }
		: undefined;

const mapDetails = (raw: RawPlaceDetails): PlaceDetails => ({
	id: normalisePlaceId(raw.id),
	displayName: raw.displayName?.text,
	location: toLatLng(raw.location),
	formattedAddress: raw.formattedAddress,
	rating: raw.rating,
	userRatingCount: raw.userRatingCount,
	primaryType: raw.primaryType,
	primaryTypeDisplayName: raw.primaryTypeDisplayName?.text,
	types: raw.types,
	regularOpeningHours: raw.regularOpeningHours
		? { weekdayDescriptions: raw.regularOpeningHours.weekdayDescriptions ?? [] }
		: undefined,
	websiteUri: raw.websiteUri,
	nationalPhoneNumber: raw.nationalPhoneNumber,
	businessStatus: raw.businessStatus,
	editorialSummary: raw.editorialSummary?.text,
});

const toEntry = (raw: { id?: string; movedPlaceId?: string }): PlaceIdEntry | null => {
	const id = normalisePlaceId(raw.id);
	if (!id) return null;
	const movedPlaceId = normalisePlaceId(raw.movedPlaceId);
	return movedPlaceId ? { id, movedPlaceId } : { id };
};

export interface PlacesClientOptions {
	apiKey?: string;
	transport?: HttpTransport;
	sleep?: Sleep;
	retryBaseDelayMs?: number;
	defaultRadiusM?: number;
}

export type PlacesClient = ReturnType<typeof createPlacesClient>;

export const createPlacesClient = (options: PlacesClientOptions = {}) => {
	const transport = options.transport ?? createAxiosTransport();
	const sleep = options.sleep ?? defaultSleep;
	const retryBaseDelayMs = options.retryBaseDelayMs ?? 500;
	const defaultRadiusM = options.defaultRadiusM ?? 5000;
	const stats: PlacesCallStats = { ids_only: 0, pro: 0, enterprise: 0, details: 0 };

	const requireKey = (): string => {
		if (!options.apiKey) throw new PlacesConfigError();
		return options.apiKey;
	};

	// One logical request (with retry). Returns the data and the number of HTTP attempts.
	const send = async <T>(
		sku: keyof PlacesCallStats,
		label: string,
		request: Omit<HttpRequest, 'headers'>,
		fieldMask: string,
		apiKey: string,
	): Promise<{ data: T; attempts: number }> => {
		const started = Date.now();
		try {
			const { value, attempts } = await withRetry(
				() =>
					transport<T>({
						...request,
						headers: {
							'Content-Type': 'application/json',
							'X-Goog-Api-Key': apiKey,
							'X-Goog-FieldMask': fieldMask,
						},
					}),
				{ sleep, baseDelayMs: retryBaseDelayMs },
			);
			stats[sku] += attempts;
			logger.debug(`places ${label} status=${value.status} attempts=${attempts} ${Date.now() - started}ms`);
			return { data: value.data, attempts };
		} catch (err) {
			if (!isTransportError(err)) throw err;
			const error = toHttpRequestError(err);
			stats[sku] += error.attempts;
			logger.warn(
				`places ${label} failed status=${error.status ?? error.code} attempts=${error.attempts} ${Date.now() - started}ms`,
			);
			throw error;
		}
	};

	const searchBody = (params: SearchTextParams, pageToken?: string, pageSize: number = PAGE_SIZE) => ({
		textQuery: params.textQuery,
		regionCode: params.regionCode.toLowerCase(),
		pageSize,
		...(params.center
			? {
					locationBias: {
						circle: {
							center: { latitude: params.center.latitude, longitude: params.center.longitude },
							radius: params.radiusM ?? defaultRadiusM,
						},
					},
				}
			: {}),
		...(pageToken ? { pageToken } : {}),
	});

	/**
	 * IDs-only Text Search (free Essentials SKU). Pages up to maxPages (default 3 = 60 results)
	 * and stops early once every stopWhenFound ID has appeared as an id or movedPlaceId.
	 */
	const searchTextIds = async (params: SearchTextIdsParams): Promise<SearchTextIdsResult> => {
		assertIdsOnlyMask(IDS_ONLY_FIELD_MASK);
		const apiKey = requireKey();
		assertSearchParams(params);
		const maxPages = params.maxPages ?? MAX_PAGES;
		if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > MAX_PAGES) {
			throw new Error(`maxPages must be 1-${MAX_PAGES}`);
		}
		const targets = new Set((params.stopWhenFound ?? []).map((id) => normalisePlaceId(id) as string));
		const seen = new Set<string>();
		const places: PlaceIdEntry[] = [];
		let apiCalls = 0;
		let pagesFetched = 0;
		let pageToken: string | undefined;

		do {
			let response: { data: RawSearchTextResponse; attempts: number };
			try {
				response = await send<RawSearchTextResponse>(
					'ids_only',
					`searchTextIds page=${pagesFetched + 1}`,
					{ method: 'POST', url: `${BASE_URL}/places:searchText`, data: searchBody(params, pageToken) },
					IDS_ONLY_FIELD_MASK,
					apiKey,
				);
			} catch (err) {
				if (!(err instanceof HttpRequestError)) throw err;
				const error = err;
				throw new PlacesApiError(error, apiCalls + error.attempts);
			}
			apiCalls += response.attempts;
			pagesFetched += 1;
			for (const raw of response.data.places ?? []) {
				const entry = toEntry(raw);
				if (!entry) continue;
				places.push(entry);
				if (targets.has(entry.id)) seen.add(entry.id);
				if (entry.movedPlaceId && targets.has(entry.movedPlaceId)) seen.add(entry.movedPlaceId);
			}
			pageToken = response.data.nextPageToken;
			if (targets.size > 0 && seen.size === targets.size) {
				return { places, pagesFetched, apiCalls, stoppedEarly: Boolean(pageToken) && pagesFetched < maxPages };
			}
		} while (pageToken && pagesFetched < maxPages);

		return { places, pagesFetched, apiCalls, stoppedEarly: false };
	};

	/** Text Search with displayName (Pro SKU). Exactly one page (top 20). Map Ranking only. */
	const searchTextWithNames = async (params: SearchTextParams): Promise<SearchTextWithNamesResult> => {
		const apiKey = requireKey();
		assertSearchParams(params);
		try {
			const { data, attempts } = await send<RawSearchTextResponse>(
				'pro',
				'searchTextWithNames page=1',
				{ method: 'POST', url: `${BASE_URL}/places:searchText`, data: searchBody(params) },
				WITH_NAMES_FIELD_MASK,
				apiKey,
			);
			const places: NamedPlaceEntry[] = [];
			for (const raw of data.places ?? []) {
				const entry = toEntry(raw);
				if (entry) places.push({ ...entry, name: raw.displayName?.text ?? null });
			}
			return { places, apiCalls: attempts };
		} catch (err) {
			if (!(err instanceof HttpRequestError)) throw err;
			const error = err;
			throw new PlacesApiError(error, error.attempts);
		}
	};

	/** Competitor suggestions: one page (20) with names, addresses, rating and review count (Enterprise SKU). */
	const searchTextForSuggestions = async (params: SearchTextParams): Promise<SearchTextSuggestionsResult> => {
		const apiKey = requireKey();
		assertSearchParams(params);
		assertExactMask(SUGGESTIONS_FIELD_MASK, SUGGESTIONS_FIELD_MASK);
		try {
			const { data, attempts } = await send<RawSearchTextResponse>(
				'enterprise',
				'searchTextForSuggestions page=1',
				{ method: 'POST', url: `${BASE_URL}/places:searchText`, data: searchBody(params) },
				SUGGESTIONS_FIELD_MASK,
				apiKey,
			);
			const places: SuggestionPlace[] = [];
			for (const raw of data.places ?? []) {
				const entry = toEntry(raw);
				if (!entry) continue;
				places.push({
					...entry,
					name: raw.displayName?.text ?? null,
					address: raw.formattedAddress ?? null,
					rating: typeof raw.rating === 'number' ? raw.rating : null,
					userRatingCount: typeof raw.userRatingCount === 'number' ? raw.userRatingCount : null,
				});
			}
			return { places, apiCalls: attempts };
		} catch (err) {
			if (!(err instanceof HttpRequestError)) throw err;
			throw new PlacesApiError(err, err.attempts);
		}
	};

	/** Manual competitor search: up to 10 names + addresses (Pro SKU). */
	const searchTextNamesAddresses = async (params: SearchTextParams): Promise<SearchTextNamesAddressesResult> => {
		const apiKey = requireKey();
		assertSearchParams(params);
		assertExactMask(NAMES_ADDRESSES_FIELD_MASK, NAMES_ADDRESSES_FIELD_MASK);
		try {
			const { data, attempts } = await send<RawSearchTextResponse>(
				'pro',
				'searchTextNamesAddresses page=1',
				{
					method: 'POST',
					url: `${BASE_URL}/places:searchText`,
					data: searchBody(params, undefined, MANUAL_SEARCH_PAGE_SIZE),
				},
				NAMES_ADDRESSES_FIELD_MASK,
				apiKey,
			);
			const places: NameAddressPlace[] = [];
			for (const raw of (data.places ?? []).slice(0, MANUAL_SEARCH_PAGE_SIZE)) {
				const entry = toEntry(raw);
				if (entry) places.push({ id: entry.id, name: raw.displayName?.text ?? null, address: raw.formattedAddress ?? null });
			}
			return { places, apiCalls: attempts };
		} catch (err) {
			if (!(err instanceof HttpRequestError)) throw err;
			throw new PlacesApiError(err, err.attempts);
		}
	};

	/** Place Details for the given fields (names without the "places." prefix). */
	const getPlaceDetails = async (placeId: string, fields: PlaceDetailsField[]): Promise<PlaceDetailsResult> => {
		const apiKey = requireKey();
		const id = normalisePlaceId(placeId);
		if (!id) throw new Error('placeId is required');
		if (fields.length === 0) throw new Error('At least one Place Details field is required');
		for (const field of fields as string[]) {
			if (!field || field === '*' || field.startsWith('places.') || /[\s,]/.test(field)) {
				throw new Error(`Invalid Place Details field "${field}"`);
			}
		}
		try {
			const { data, attempts } = await send<RawPlaceDetails>(
				'details',
				'getPlaceDetails',
				{ method: 'GET', url: `${BASE_URL}/places/${encodeURIComponent(id)}` },
				fields.join(','),
				apiKey,
			);
			return { details: mapDetails(data), apiCalls: attempts };
		} catch (err) {
			if (!(err instanceof HttpRequestError)) throw err;
			const error = err;
			throw new PlacesApiError(error, error.attempts);
		}
	};

	const getStats = (): PlacesCallStats => ({ ...stats });

	return { searchTextIds, searchTextWithNames, searchTextForSuggestions, searchTextNamesAddresses, getPlaceDetails, getStats };
};

/** Default client configured from the environment. Throws PlacesConfigError on use if no key is set. */
export const placesClient: PlacesClient = createPlacesClient({
	apiKey: config.googleApis.placeApi.keySecret,
	defaultRadiusM: config.ranking.searchRadiusM,
});
