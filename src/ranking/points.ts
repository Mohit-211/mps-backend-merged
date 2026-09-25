import config from '../configs/config';
import { GeoPoint, GridPoint, GridSize, TrackerPoint } from './types';

// Sample points around a location (CLAUDE.md §4 "Sample points").
// Offsets use the same flat-earth conversion as the legacy generateGrid() in
// helpers/localSearchGridReport.ts (ported, not imported; that file is deleted in Phase 9).

const EARTH_RADIUS_KM = 6371;
const DEG_PER_RAD = 180 / Math.PI;
const MAX_ABS_LAT = 85;

export const GRID_SIZES: readonly GridSize[] = [3, 5, 7];
export const MIN_SPACING_KM = 0.25;
export const MAX_SPACING_KM = 5;

const assertCenter = (center: GeoPoint): void => {
	const { lat, lng } = center;
	if (!Number.isFinite(lat) || Math.abs(lat) > MAX_ABS_LAT) throw new Error(`Invalid center latitude: ${lat}`);
	if (!Number.isFinite(lng) || Math.abs(lng) > 180) throw new Error(`Invalid center longitude: ${lng}`);
};

/** Moves a point northKm north and eastKm east (negative values go south/west). */
export const offsetPoint = (center: GeoPoint, northKm: number, eastKm: number): GeoPoint => {
	const dLat = (northKm / EARTH_RADIUS_KM) * DEG_PER_RAD;
	const dLng = (eastKm / (EARTH_RADIUS_KM * Math.cos((center.lat * Math.PI) / 180))) * DEG_PER_RAD;
	return { lat: center.lat + dLat, lng: center.lng + dLng };
};

/** Rank Tracker points: the center plus N, S, E, W at offsetKm (5 points, center first). */
export const trackerPoints = (
	center: GeoPoint,
	offsetKm: number = config.ranking.trackerOffsetKm,
): TrackerPoint[] => {
	assertCenter(center);
	if (!Number.isFinite(offsetKm) || offsetKm <= 0 || offsetKm > 20) {
		throw new Error(`Invalid tracker offset: ${offsetKm} km`);
	}
	return [
		{ label: 'C', lat: center.lat, lng: center.lng },
		{ label: 'N', ...offsetPoint(center, offsetKm, 0) },
		{ label: 'S', ...offsetPoint(center, -offsetKm, 0) },
		{ label: 'E', ...offsetPoint(center, 0, offsetKm) },
		{ label: 'W', ...offsetPoint(center, 0, -offsetKm) },
	];
};

export const isGridSize = (size: number): size is GridSize => (GRID_SIZES as readonly number[]).includes(size);

/**
 * Local Search Grid points: size × size points spacingKm apart, in heatmap order
 * (row 0 = north, col 0 = west). The center (half, half) is exactly the given center.
 */
export const gridPoints = (center: GeoPoint, size: number, spacingKm: number): GridPoint[] => {
	assertCenter(center);
	if (!isGridSize(size)) throw new Error(`Invalid grid size: ${size} (allowed: ${GRID_SIZES.join(', ')})`);
	if (!Number.isFinite(spacingKm) || spacingKm < MIN_SPACING_KM || spacingKm > MAX_SPACING_KM) {
		throw new Error(`Invalid grid spacing: ${spacingKm} km (allowed ${MIN_SPACING_KM}–${MAX_SPACING_KM})`);
	}
	const half = Math.floor(size / 2);
	const points: GridPoint[] = [];
	for (let row = 0; row < size; row++) {
		for (let col = 0; col < size; col++) {
			const northKm = (half - row) * spacingKm;
			const eastKm = (col - half) * spacingKm;
			const point = row === half && col === half ? { ...center } : offsetPoint(center, northKm, eastKm);
			points.push({ row, col, lat: point.lat, lng: point.lng });
		}
	}
	return points;
};
