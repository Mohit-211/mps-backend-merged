import type { PlaceDetailsField } from '../../clients/types/places';

// Billing SKUs for the usage ledger (Phase 12.5). Every Places API (New) call and every GBP call is
// counted under one of these keys (counts only; prices are applied by cost:report).

export const PLACES_SKUS = [
	'places.text.ids_only',
	'places.text.pro',
	'places.text.enterprise',
	'places.details.ids_only',
	'places.details.essentials',
	'places.details.pro',
	'places.details.enterprise',
	'places.details.enterprise_atmosphere',
] as const;
export const GBP_SKUS = ['gbp.account_management', 'gbp.business_information', 'gbp.performance', 'gbp.verifications', 'gbp.v4', 'gbp.oauth', 'gbp.other'] as const;
export type PlacesSku = (typeof PLACES_SKUS)[number];
export type GbpSku = (typeof GBP_SKUS)[number];
export type UsageSku = PlacesSku | GbpSku;
export const USAGE_SKUS: readonly UsageSku[] = [...PLACES_SKUS, ...GBP_SKUS];

type DetailsTier = 'ids_only' | 'essentials' | 'pro' | 'enterprise' | 'enterprise_atmosphere';
const TIER_ORDER: DetailsTier[] = ['ids_only', 'essentials', 'pro', 'enterprise', 'enterprise_atmosphere'];

/** Place Details field → the SKU tier it bills on (Google's Places API (New) field groups). */
export const DETAILS_FIELD_TIER: Record<PlaceDetailsField, DetailsTier> = {
	id: 'ids_only',
	photos: 'ids_only',
	location: 'essentials',
	formattedAddress: 'essentials',
	addressComponents: 'essentials',
	types: 'essentials',
	displayName: 'pro',
	primaryType: 'pro',
	primaryTypeDisplayName: 'pro',
	businessStatus: 'pro',
	rating: 'enterprise',
	userRatingCount: 'enterprise',
	regularOpeningHours: 'enterprise',
	websiteUri: 'enterprise',
	nationalPhoneNumber: 'enterprise',
	editorialSummary: 'enterprise_atmosphere',
	reviews: 'enterprise_atmosphere',
};

/** A Place Details call bills on the highest tier among its requested fields. */
export const detailsSkuFor = (fields: readonly PlaceDetailsField[]): PlacesSku => {
	let tier = 0;
	for (const f of fields) tier = Math.max(tier, TIER_ORDER.indexOf(DETAILS_FIELD_TIER[f] ?? 'enterprise_atmosphere'));
	return `places.details.${TIER_ORDER[tier]}` as PlacesSku;
};

/** GBP API family of a request URL. */
export const gbpSkuFor = (url: string): GbpSku => {
	if (url.includes('mybusinessaccountmanagement')) return 'gbp.account_management';
	if (url.includes('mybusinessbusinessinformation')) return 'gbp.business_information';
	if (url.includes('businessprofileperformance')) return 'gbp.performance';
	if (url.includes('mybusinessverifications')) return 'gbp.verifications';
	if (url.includes('mybusiness.googleapis.com/v4')) return 'gbp.v4';
	if (url.includes('oauth2.googleapis.com')) return 'gbp.oauth';
	return 'gbp.other';
};
