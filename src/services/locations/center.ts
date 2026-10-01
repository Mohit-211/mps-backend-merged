import { ILocation } from '../../models/location.model';

// Where a location's rankings are measured from (2026-10-01), for "Measured around: …":
//   place   the business's own Google Maps position (Place Details or the GBP profile); label = its address
//   manual  a city / ZIP / region chosen at setup (service-area businesses); label = what was picked or typed
// null when the location has no center yet.

export type CenterKind = 'place' | 'manual';

export interface CenterView {
	source: CenterKind;
	label: string | null;
	lat: number;
	lng: number;
}

type CenterInput = Pick<ILocation, 'lat' | 'lng' | 'center_source' | 'center_label' | 'address' | 'city' | 'state'>;

const placeLabel = (l: CenterInput): string | null => {
	if (l.address && l.address !== 'n/a') return l.address;
	const parts = [l.city, l.state].filter((p): p is string => Boolean(p) && p !== 'n/a');
	return parts.length ? parts.join(', ') : null;
};

export const centerView = (location: CenterInput): CenterView | null => {
	if (typeof location.lat !== 'number' || typeof location.lng !== 'number') return null;
	const manual = location.center_source === 'manual';
	return {
		source: manual ? 'manual' : 'place',
		label: manual ? (location.center_label ?? null) : placeLabel(location),
		lat: location.lat,
		lng: location.lng,
	};
};
