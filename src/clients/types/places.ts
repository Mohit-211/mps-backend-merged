// Types for the Places API (New) client.
// Raw* types describe what Google returns; they are mapped to the plain types below
// immediately inside placesClient.ts, so nothing outside the client sees raw shapes.

export interface LatLng {
	latitude: number;
	longitude: number;
}

export interface SearchTextParams {
	textQuery: string;
	/** CLDR region code, e.g. 'us' or 'ca'. */
	regionCode: string;
	/**
	 * Center of the locationBias circle (the sample point). Ranking always sets it; only the
	 * city/ZIP center lookup (no known location yet) omits it, which sends no locationBias.
	 */
	center?: LatLng;
	/** Circle radius in metres; defaults to PLACES_SEARCH_RADIUS_M. */
	radiusM?: number;
}

export interface SearchTextIdsParams extends SearchTextParams {
	/** Stop paging once every one of these place IDs has been seen (as id or movedPlaceId). */
	stopWhenFound?: string[];
	/** 1–3 pages of 20 results; defaults to 3 (60 results). */
	maxPages?: number;
}

export interface PlaceIdEntry {
	id: string;
	/** Set when this listing has permanently moved to another place ID. */
	movedPlaceId?: string;
}

export interface NamedPlaceEntry extends PlaceIdEntry {
	name: string | null;
}

export interface SearchTextIdsResult {
	/** Results in rank order (index 0 = rank 1) across all fetched pages. */
	places: PlaceIdEntry[];
	pagesFetched: number;
	/** HTTP calls made, including retries. */
	apiCalls: number;
	/** True when paging stopped because every stopWhenFound ID was seen while more pages existed. */
	stoppedEarly: boolean;
}

export interface SearchTextWithNamesResult {
	places: NamedPlaceEntry[];
	apiCalls: number;
}

/** Competitor suggestion candidate (Text Search Enterprise fields). */
export interface SuggestionPlace extends PlaceIdEntry {
	name: string | null;
	address: string | null;
	rating: number | null;
	userRatingCount: number | null;
}

export interface SearchTextSuggestionsResult {
	places: SuggestionPlace[];
	apiCalls: number;
}

/** Manual competitor search result (Text Search Pro fields). */
export interface NameAddressPlace {
	id: string;
	name: string | null;
	address: string | null;
}

export interface SearchTextNamesAddressesResult {
	places: NameAddressPlace[];
	apiCalls: number;
}

/** Place Details field names, without the "places." prefix used by Text Search masks. */
export type PlaceDetailsField =
	| 'id'
	| 'displayName'
	| 'location'
	| 'formattedAddress'
	| 'rating'
	| 'userRatingCount'
	| 'primaryType'
	| 'primaryTypeDisplayName'
	| 'types'
	| 'regularOpeningHours'
	| 'websiteUri'
	| 'nationalPhoneNumber'
	| 'businessStatus'
	| 'editorialSummary';

export interface PlaceDetails {
	id?: string;
	displayName?: string;
	location?: LatLng;
	formattedAddress?: string;
	rating?: number;
	userRatingCount?: number;
	primaryType?: string;
	primaryTypeDisplayName?: string;
	types?: string[];
	regularOpeningHours?: { weekdayDescriptions: string[] };
	websiteUri?: string;
	nationalPhoneNumber?: string;
	businessStatus?: string;
	editorialSummary?: string;
}

export interface PlaceDetailsResult {
	details: PlaceDetails;
	apiCalls: number;
}

/** Calls per billing SKU since the client was created (retries included). */
export interface PlacesCallStats {
	ids_only: number;
	pro: number;
	/** Text Search Enterprise (rating / userRatingCount): competitor suggestions only. */
	enterprise: number;
	details: number;
}

// ---- Raw API shapes (boundary only) ----

export interface RawLocalizedText {
	text?: string;
	languageCode?: string;
}

export interface RawPlace {
	id?: string;
	movedPlaceId?: string;
	displayName?: RawLocalizedText;
	formattedAddress?: string;
	rating?: number;
	userRatingCount?: number;
}

export interface RawSearchTextResponse {
	places?: RawPlace[];
	nextPageToken?: string;
}

export interface RawPlaceDetails {
	id?: string;
	displayName?: RawLocalizedText;
	location?: { latitude?: number; longitude?: number };
	formattedAddress?: string;
	rating?: number;
	userRatingCount?: number;
	primaryType?: string;
	primaryTypeDisplayName?: RawLocalizedText;
	types?: string[];
	regularOpeningHours?: { weekdayDescriptions?: string[] };
	websiteUri?: string;
	nationalPhoneNumber?: string;
	businessStatus?: string;
	editorialSummary?: RawLocalizedText;
}
