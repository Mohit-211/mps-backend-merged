import { GeoPoint } from '../types';
import { PlacesScript, ScriptContext, ScriptedPlaces, createScriptedPlaces } from './scriptedPlaces';

// Offline demo scenario for `npm run seed:rank-demo` (no API key, no network). Three weekly runs of
// a Toronto plumber with 3 keywords and 2 competitors, designed so the frontend sees every case:
// - "emergency plumber":   the client improves 12 → 7 → 3 at the center; competitor 1 declines.
// - "drain cleaning":      found in run 1, not found anywhere in run 2 (dropped_out_of_top_60),
//                          found again in run 3 (entered_top_60).
// - "water heater repair": rank worsens with distance, so the grid corners are 60+; in run 3 one grid
//                          corner fails (an error cell, making that run partial).

export const DEMO_PLACE_IDS = {
	self: 'ChIJdemoMapleLeafPlumbing01',
	competitor_1: 'ChIJdemoQueenWestPlumbing02',
	competitor_2: 'ChIJdemoDanforthDrainPros03',
};

export const DEMO_CENTER: GeoPoint = { lat: 43.6629, lng: -79.3347 };

export const DEMO_KEYWORDS = ['Emergency Plumber', 'Drain Cleaning', 'Water Heater Repair'];

const NAMES: Record<string, string> = {
	[DEMO_PLACE_IDS.self]: 'Maple Leaf Plumbing & Heating',
	[DEMO_PLACE_IDS.competitor_1]: 'Queen West Plumbing Co.',
	[DEMO_PLACE_IDS.competitor_2]: 'Danforth Drain Pros',
};

const FILLER_NAMES = [
	'Riverdale Plumbing', 'Leslieville Drain Service', 'Annex Heating & Cooling', 'Junction Plumbers',
	'Corktown Water Heaters', 'Yorkville Pipe Repair', 'Parkdale Plumbing & Drains', 'Liberty Village Plumbing',
	'Cabbagetown Heating', 'Kensington Drain Experts', 'Roncesvalles Plumbing', 'Leaside Water Heater Pros',
	'Harbourfront Plumbing', 'Midtown Drain & Sewer', 'East York Plumbing', 'Scarborough Pipe Masters',
	'North York Plumbing Co.', 'Etobicoke Drain Care', 'Distillery Plumbing', 'Danforth Heating & Air',
];

const distanceKm = (ctx: ScriptContext): number => {
	const dLat = (ctx.lat - DEMO_CENTER.lat) * 111.2;
	const dLng = (ctx.lng - DEMO_CENTER.lng) * 111.2 * Math.cos((DEMO_CENTER.lat * Math.PI) / 180);
	return Math.sqrt(dLat * dLat + dLng * dLng);
};

const clamp = (rank: number): number | null => (rank >= 1 && rank <= 60 ? Math.round(rank) : null);

const keywordOf = (ctx: ScriptContext): 'emergency' | 'drain' | 'water' => {
	const k = ctx.keyword.toLowerCase();
	if (k.startsWith('emergency')) return 'emergency';
	if (k.startsWith('drain')) return 'drain';
	return 'water';
};

/** Ranks for run 0, 1, 2 (oldest first). */
const scenario = (run: 0 | 1 | 2) => (ctx: ScriptContext & { placeId: string }): number | null => {
	const d = distanceKm(ctx);
	const kw = keywordOf(ctx);
	const isSelf = ctx.placeId === DEMO_PLACE_IDS.self;
	const isC1 = ctx.placeId === DEMO_PLACE_IDS.competitor_1;
	if (kw === 'emergency') {
		if (isSelf) return clamp([12, 7, 3][run] + d * 2);
		if (isC1) return clamp([2, 4, 6][run] + d);
		return clamp(9 + d * 1.5);
	}
	if (kw === 'drain') {
		if (isSelf) return run === 1 ? null : clamp([18, 0, 24][run] + d * 3);
		if (isC1) return clamp(14 + d * 2);
		return clamp([3, 2, 2][run] + d);
	}
	// water heater repair
	if (isSelf) return clamp([6, 5, 4][run] + d * 22); // corners (~2.8 km) fall past 60 → "60+"
	if (isC1) return run === 0 ? null : clamp(30 + d * 10);
	return clamp(11 + d * 4);
};

/** Offline Places client for demo run 0, 1 or 2. */
export const createDemoPlaces = (run: 0 | 1 | 2): ScriptedPlaces => {
	const script: PlacesScript = {
		rank: scenario(run),
		candidates: Object.values(DEMO_PLACE_IDS),
		name: (placeId, rank) => NAMES[placeId] ?? FILLER_NAMES[(rank - 1) % FILLER_NAMES.length],
		// Run 3: the north-west grid corner fails for "water heater repair".
		fail: (ctx) =>
			run === 2 && keywordOf(ctx) === 'water' && ctx.lat > DEMO_CENTER.lat + 0.015 && ctx.lng < DEMO_CENTER.lng - 0.02,
		details: DEMO_CENTER,
	};
	return createScriptedPlaces(script);
};
