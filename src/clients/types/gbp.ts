// Typed shapes for the Google Business Profile APIs used by gbpClient. Raw responses are mapped
// into these at the client boundary; only the fields MyPageSEO uses are modelled.

export interface GbpAccount {
	/** Resource name, "accounts/123". */
	name: string;
	accountName: string | null;
	type: string | null;
	role: string | null;
	verificationState: string | null;
}

export interface GbpPostalAddress {
	regionCode: string | null;
	postalCode: string | null;
	administrativeArea: string | null;
	locality: string | null;
	addressLines: string[];
}

export interface GbpLocation {
	/** Resource name, "locations/456". */
	name: string;
	title: string | null;
	languageCode: string | null;
	storefrontAddress: GbpPostalAddress | null;
	/** serviceArea.regionCode: the country of a service-area business (no storefront). */
	serviceAreaRegionCode: string | null;
	primaryPhone: string | null;
	websiteUri: string | null;
	primaryCategory: string | null;
	latlng: { latitude: number; longitude: number } | null;
	/** metadata.placeId: the Maps place ID, or null if Google has none (e.g. unverified). */
	placeId: string | null;
	metadata: Record<string, unknown> | null;
	profile: Record<string, unknown> | null;
}

/** Token endpoint result, mapped (expires_in → absolute expiry). */
export interface OAuthTokens {
	accessToken: string;
	refreshToken: string | null;
	expiryDate: Date;
	scope: string | null;
	/** OpenID Connect id_token (present when the openid scope was granted). Verify before use. */
	idToken: string | null;
}

// ---- raw API response shapes (boundary only) ----

export interface RawAccount {
	name?: string;
	accountName?: string;
	type?: string;
	role?: string;
	verificationState?: string;
}

export interface RawAccountsPage {
	accounts?: RawAccount[];
	nextPageToken?: string;
}

export interface RawLocation {
	name?: string;
	title?: string;
	languageCode?: string;
	storefrontAddress?: {
		regionCode?: string;
		postalCode?: string;
		administrativeArea?: string;
		locality?: string;
		addressLines?: string[];
	};
	serviceArea?: { regionCode?: string };
	phoneNumbers?: { primaryPhone?: string };
	websiteUri?: string;
	categories?: { primaryCategory?: { displayName?: string } };
	latlng?: { latitude?: number; longitude?: number };
	metadata?: Record<string, unknown> & { placeId?: string };
	profile?: Record<string, unknown>;
}

export interface RawLocationsPage {
	locations?: RawLocation[];
	nextPageToken?: string;
}

export interface RawTokenResponse {
	access_token?: string;
	refresh_token?: string;
	expires_in?: number;
	scope?: string;
	token_type?: string;
	id_token?: string;
}

// ---- Phase 7b: sync endpoints (raw shapes, boundary only) ----

export interface GoogleDate {
	year?: number;
	month?: number;
	day?: number;
}

export interface RawDailyMetricsResponse {
	multiDailyMetricTimeSeries?: {
		dailyMetricTimeSeries?: {
			dailyMetric?: string;
			timeSeries?: { datedValues?: { date?: GoogleDate; value?: string }[] };
		}[];
	}[];
}

export interface RawSearchKeywordsPage {
	searchKeywordsCounts?: { searchKeyword?: string; insightsValue?: { value?: string; threshold?: string } }[];
	nextPageToken?: string;
}

export interface RawAttributes {
	name?: string;
	attributes?: { name?: string; valueType?: string; values?: unknown[]; repeatedEnumValue?: { setValues?: string[] }; uriValues?: { uri?: string }[] }[];
}

export interface RawGoogleUpdated {
	location?: Record<string, unknown>;
	diffMask?: string;
	pendingMask?: string;
}

export interface RawVoiceOfMerchantState {
	hasVoiceOfMerchant?: boolean;
	hasBusinessAuthority?: boolean;
	waitForVoiceOfMerchant?: Record<string, unknown>;
	verify?: { hasPendingVerification?: boolean };
	resolveOwnershipConflict?: Record<string, unknown>;
	complyWithGuidelines?: { recommendationReason?: string };
}

export interface RawReview {
	name?: string;
	reviewer?: { displayName?: string; isAnonymous?: boolean };
	starRating?: string;
	comment?: string;
	createTime?: string;
	updateTime?: string;
	reviewReply?: { comment?: string; updateTime?: string };
}

export interface RawReviewsPage {
	reviews?: RawReview[];
	averageRating?: number;
	totalReviewCount?: number;
	nextPageToken?: string;
}

export interface RawMediaItem {
	name?: string;
	mediaFormat?: string;
	createTime?: string;
	locationAssociation?: { category?: string };
}

export interface RawMediaPage {
	mediaItems?: RawMediaItem[];
	totalMediaItemCount?: number;
	nextPageToken?: string;
}

export interface RawLocalPost {
	name?: string;
	createTime?: string;
	updateTime?: string;
	state?: string;
	topicType?: string;
	searchUrl?: string;
}

export interface RawLocalPostsPage {
	localPosts?: RawLocalPost[];
	nextPageToken?: string;
}

/** A calendar date range (inclusive) for the Performance API. */
export interface DateRange {
	start: { year: number; month: number; day: number };
	end: { year: number; month: number; day: number };
}

/** v4 lists: every item across pages, plus the list-level fields of the first page. */
export interface PagedList<T> {
	items: T[];
	pages: number;
	truncated: boolean;
}
