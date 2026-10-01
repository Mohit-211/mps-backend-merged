import { Types } from 'mongoose';
import logger from '../../configs/logger';
import {
	GbpAccessNotApprovedError,
	GbpApiDisabledError,
	GbpClient,
	GbpReauthRequiredError,
	gbpClient,
} from '../../clients/gbpClient';
import { GbpAccount, GbpLocation, GbpPostalAddress } from '../../clients/types/gbp';
import { UserGBP } from '../../models';
import { toGbpApiError } from './errors';

// GBP location discovery for binding (CLAUDE.md §10; AUDIT C9, C22): every account the user can
// access, every location of each (paginated), mapped from Business Information only. No Places calls.

export interface DiscoveredLocation {
	/** The connected Google account this profile was listed through (pass it back on bind). */
	google_sub: string | null;
	gbpAccountId: string;
	accountName: string | null;
	gbpLocationId: string;
	title: string | null;
	websiteUri: string;
	languageCode: string | null;
	metadata: Record<string, unknown> | null;
	profile: Record<string, unknown> | null;
	mobile: string | null;
	business_category: string | null;
	country: string | null;
	state: string | null;
	city: string | null;
	zip_code: string | null;
	address: string | null;
	/** Storefront country, or the service area's for a business without a storefront ("US", "CA", …). */
	region_code: string | null;
	place_id: string | null;
	latlng: { latitude: number; longitude: number } | null;
	bound_location_id: string | null;
}

type UserId = Types.ObjectId | string;

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

export const countryName = (regionCode: string | null): string | null => {
	if (!regionCode) return null;
	try {
		return regionNames.of(regionCode) ?? null;
	} catch {
		return null;
	}
};

/** "100 Example St, Suite 5, Dallas, TX 75201" from the storefront address; null without one. */
export const formatAddress = (address: GbpPostalAddress | null): string | null => {
	if (!address) return null;
	const regionLine = [address.administrativeArea, address.postalCode].filter(Boolean).join(' ');
	const parts = [...address.addressLines, address.locality, regionLine].filter((p): p is string => Boolean(p && p.trim()));
	return parts.length > 0 ? parts.join(', ') : null;
};

export const toDiscovered = (
	account: GbpAccount,
	location: GbpLocation,
	boundTo: string | null,
	googleSub: string | null = null,
): DiscoveredLocation => ({
	google_sub: googleSub,
	gbpAccountId: account.name,
	accountName: account.accountName,
	gbpLocationId: location.name,
	title: location.title,
	websiteUri: location.websiteUri ?? 'NA', // legacy response value for "no website"
	languageCode: location.languageCode,
	metadata: location.metadata,
	profile: location.profile,
	mobile: location.primaryPhone,
	business_category: location.primaryCategory,
	country: countryName(location.storefrontAddress?.regionCode ?? null),
	state: location.storefrontAddress?.administrativeArea ?? null,
	city: location.storefrontAddress?.locality ?? null,
	zip_code: location.storefrontAddress?.postalCode ?? null,
	address: formatAddress(location.storefrontAddress),
	region_code: location.storefrontAddress?.regionCode ?? location.serviceAreaRegionCode,
	place_id: location.placeId,
	latlng: location.latlng,
	bound_location_id: boundTo,
});

/** Errors that affect a whole connection: stop listing it and report it on its group. */
const isConnectionWide = (err: unknown): boolean =>
	err instanceof GbpAccessNotApprovedError || err instanceof GbpApiDisabledError || err instanceof GbpReauthRequiredError;

export interface DiscoveryDeps {
	client?: Pick<GbpClient, 'listAccounts' | 'listLocations'>;
}

export const createDiscoveryService = (deps: DiscoveryDeps = {}) => {
	const client = deps.client ?? gbpClient;

	const listConnection = async (userId: UserId, sub: string | null, boundTo: Map<string, string>) => {
		const accounts = await client.listAccounts({ userId, googleSub: sub });
		const locations: DiscoveredLocation[] = [];
		const errors: { account: string; message: string }[] = [];
		const seen = new Set<string>();
		for (const account of accounts) {
			try {
				for (const location of await client.listLocations({ userId, googleSub: sub }, account.name)) {
					// A location can appear under several accounts (owner + location group): list it once.
					if (seen.has(location.name)) continue;
					seen.add(location.name);
					locations.push(toDiscovered(account, location, boundTo.get(location.name) ?? null, sub));
				}
			} catch (err) {
				if (isConnectionWide(err)) throw err;
				const message = err instanceof Error ? err.message : 'unknown error';
				logger.warn(`gbp discovery: listing ${account.name} failed: ${message}`);
				errors.push({ account: account.name, message });
			}
		}
		return { accounts: accounts.length, locations, errors };
	};

	/**
	 * The profiles of one connected Google account (2026-10-01: the connect modal lists one account at a time).
	 * Connection-wide failures (revoked, access not approved) are thrown as API errors.
	 */
	const listConnectionLocations = async (userId: UserId, googleSub: string) => {
		const bindings = await UserGBP.find({ user_id: userId, is_active: true }).select({ gbpLocationId: 1, location_id: 1 }).lean();
		const boundTo = new Map(bindings.map((b) => [b.gbpLocationId, String(b.location_id)]));
		try {
			return await listConnection(userId, googleSub, boundTo);
		} catch (err) {
			throw toGbpApiError(err);
		}
	};

	return { listConnectionLocations };
};

export const discoveryService = createDiscoveryService();
