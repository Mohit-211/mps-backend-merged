import { Types } from 'mongoose';
import logger from '../../configs/logger';
import { PlacesClient, placesClient } from '../../clients/placesClient';
import { ILocation, ILocationCompetitorInfo } from '../../models/location.model';
import { LeanRankRun, RankRun } from '../../models/rankRun.model';
import { PlacesUsageService, placesUsage } from '../onboarding/usage';
import { withDefaults } from './trackingSettings';

// Competitor names, addresses and positions (Phase 17, max 5 per location). Filled when competitors are
// saved, from free sources first, in order:
//   1. the competitor-suggestion cache (name, address)
//   2. the location's latest Map Ranking lists (name, address, lat/lng; any of the 5 points)
//   3. one Place Details call (displayName, formattedAddress, location) for what is still missing: counted
//      in the usage ledger and the user's daily Places cap.
// A failure (no key, Google error, daily cap) never blocks saving: the fields stay null.

export type CompetitorInfo = ILocationCompetitorInfo;

export interface CompetitorInfoDeps {
	places?: Pick<PlacesClient, 'getPlaceDetails'>;
	usage?: Pick<PlacesUsageService, 'reserve'>;
}

const empty = (placeId: string): CompetitorInfo => ({ place_id: placeId, name: null, address: null, lat: null, lng: null });
const complete = (c: CompetitorInfo): boolean => c.name !== null && c.lat !== null && c.lng !== null;

/** Fills the empty fields of `info` from `from` (never overwrites). */
const merge = (info: CompetitorInfo, from: Partial<CompetitorInfo>): CompetitorInfo => ({
	place_id: info.place_id,
	name: info.name ?? from.name ?? null,
	address: info.address ?? from.address ?? null,
	lat: info.lat ?? from.lat ?? null,
	lng: info.lng ?? from.lng ?? null,
});

/** Free sources only: the suggestion cache and the latest run's Map Ranking lists. */
const fromFreeSources = async (location: ILocation, infos: CompetitorInfo[]): Promise<CompetitorInfo[]> => {
	let out = infos.map((c) => {
		const suggestion = location.competitor_suggestions?.results?.find((r) => r.place_id === c.place_id);
		return suggestion ? merge(c, { name: suggestion.name ?? null, address: suggestion.address ?? null }) : c;
	});
	if (out.every(complete)) return out;
	const run = await RankRun.findOne({ location_id: location._id as Types.ObjectId, status: { $in: ['done', 'partial'] } })
		.sort({ run_at: -1 })
		.select({ mapList: 1 })
		.lean<Pick<LeanRankRun, 'mapList'>>();
	const results = (run?.mapList ?? []).flatMap((s) => s.results);
	out = out.map((c) => {
		const hit = results.find((r) => r.place_id === c.place_id && (r.name || (r.lat !== null && r.lat !== undefined)));
		return hit ? merge(c, { name: hit.name ?? null, address: hit.address ?? null, lat: hit.lat ?? null, lng: hit.lng ?? null }) : c;
	});
	return out;
};

export const createCompetitorInfoService = (deps: CompetitorInfoDeps = {}) => {
	const places = deps.places ?? placesClient;
	const usage = deps.usage ?? placesUsage;

	/**
	 * Details for every competitor in `placeIds` (in that order): kept entries (`stored`, default the saved
	 * ones), then free sources, then (only when `userId` is given) one Place Details call per competitor still
	 * missing a name or position.
	 */
	const resolve = async (
		location: ILocation,
		placeIds: string[],
		options: { userId?: string; stored?: CompetitorInfo[] } = {},
	): Promise<{ info: CompetitorInfo[]; api_calls: number }> => {
		const { userId } = options;
		const stored = options.stored ?? withDefaults(location.tracking).competitor_info;
		let info = placeIds.map((id) => stored.find((c) => c.place_id === id) ?? empty(id));
		if (info.every(complete)) return { info, api_calls: 0 };
		info = await fromFreeSources(location, info);
		let apiCalls = 0;
		if (userId) {
			for (const [i, c] of info.entries()) {
				if (complete(c)) continue;
				try {
					await usage.reserve(userId, 1);
					const { details, apiCalls: calls } = await places.getPlaceDetails(c.place_id, ['displayName', 'formattedAddress', 'location']);
					apiCalls += calls;
					info[i] = merge(c, {
						name: details.displayName ?? null,
						address: details.formattedAddress ?? null,
						lat: details.location?.latitude ?? null,
						lng: details.location?.longitude ?? null,
					});
				} catch (err) {
					logger.warn(`competitor info: details for a competitor of location ${String(location._id)} failed: ${(err as Error).message}`);
					break; // the same cause (no key, cap, quota) would fail the rest too
				}
			}
		}
		return { info, api_calls: apiCalls };
	};

	return { resolve };
};

export const competitorInfoService = createCompetitorInfoService();
