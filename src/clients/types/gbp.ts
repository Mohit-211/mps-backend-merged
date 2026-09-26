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
