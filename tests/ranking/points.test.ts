import legacyGrid from '../fixtures/ranking/legacy_generateGrid_toronto_5x5_750m.json';
import { gridPoints, offsetPoint, trackerPoints } from '../../src/ranking/points';
import { GeoPoint } from '../../src/ranking/types';
import { haversineKm } from '../helpers/geo';

const TORONTO: GeoPoint = { lat: 43.6629, lng: -79.3347 };
const VANCOUVER: GeoPoint = { lat: 49.2827, lng: -123.1207 };
const HIGH_LAT: GeoPoint = { lat: 60.7212, lng: -135.0568 }; // Whitehorse

const withinOnePercent = (actual: number, expected: number): void => {
	expect(Math.abs(actual - expected) / expected).toBeLessThan(0.01);
};

describe('trackerPoints', () => {
	it.each([TORONTO, VANCOUVER, HIGH_LAT])('returns center + N/S/E/W at 1.5 km (%j)', (center) => {
		const points = trackerPoints(center, 1.5);
		expect(points.map((p) => p.label)).toEqual(['C', 'N', 'S', 'E', 'W']);
		expect(points[0]).toEqual({ label: 'C', ...center });
		for (const p of points.slice(1)) withinOnePercent(haversineKm(center, p), 1.5);
		const [, n, s, e, w] = points;
		expect(n.lat).toBeGreaterThan(center.lat);
		expect(s.lat).toBeLessThan(center.lat);
		expect(e.lng).toBeGreaterThan(center.lng);
		expect(w.lng).toBeLessThan(center.lng);
		expect(n.lng).toBe(center.lng);
		expect(e.lat).toBe(center.lat);
	});

	it('defaults the offset to RANK_TRACKER_OFFSET_KM (1.5)', () => {
		withinOnePercent(haversineKm(TORONTO, trackerPoints(TORONTO)[1]), 1.5);
	});

	it.each([0, -1, 25, Number.NaN])('rejects offset %p', (offset) => {
		expect(() => trackerPoints(TORONTO, offset)).toThrow('Invalid tracker offset');
	});
});

describe('gridPoints', () => {
	it.each([
		[3, 1],
		[5, 0.25],
		[7, 5],
		[7, 1],
	])('size %i at %s km: size² points, heatmap order, center exact, spacing within 1%%', (size, spacing) => {
		for (const center of [TORONTO, HIGH_LAT]) {
			const points = gridPoints(center, size, spacing);
			const half = Math.floor(size / 2);
			expect(points).toHaveLength(size * size);
			expect(points[0]).toMatchObject({ row: 0, col: 0 });
			expect(points[points.length - 1]).toMatchObject({ row: size - 1, col: size - 1 });
			const mid = points.find((p) => p.row === half && p.col === half);
			expect(mid).toEqual({ row: half, col: half, lat: center.lat, lng: center.lng });

			const at = (row: number, col: number) => points.find((p) => p.row === row && p.col === col) as GeoPoint;
			// row 0 is north, col 0 is west
			expect(at(0, half).lat).toBeGreaterThan(center.lat);
			expect(at(size - 1, half).lat).toBeLessThan(center.lat);
			expect(at(half, 0).lng).toBeLessThan(center.lng);
			expect(at(half, size - 1).lng).toBeGreaterThan(center.lng);
			// neighbours are `spacing` apart; corners are k·spacing·√2 from the center
			withinOnePercent(haversineKm(at(half, half), at(half - 1, half)), spacing);
			withinOnePercent(haversineKm(at(half, half), at(half, half + 1)), spacing);
			withinOnePercent(haversineKm(center, at(0, 0)), half * spacing * Math.SQRT2);
		}
	});

	it('matches the legacy generateGrid() math (port regression, recorded output)', () => {
		const size = legacyGrid.size;
		const spacingKm = legacyGrid.spacing_m / 1000;
		expect(legacyGrid.center).toEqual(TORONTO);
		const legacy = legacyGrid.points;
		const points = gridPoints(TORONTO, size, spacingKm);
		for (const p of points) {
			// legacy index i runs south→north, ours runs north→south
			const legacyPoint = legacy[(size - 1 - p.row) * size + p.col];
			expect(p.lat).toBeCloseTo(legacyPoint.lat, 10);
			expect(p.lng).toBeCloseTo(legacyPoint.long, 10);
		}
	});

	it.each([
		[4, 1, 'Invalid grid size'],
		[9, 1, 'Invalid grid size'],
		[3, 0.1, 'Invalid grid spacing'],
		[3, 6, 'Invalid grid spacing'],
	])('rejects size %i / spacing %s', (size, spacing, message) => {
		expect(() => gridPoints(TORONTO, size, spacing)).toThrow(message);
	});

	it.each([
		{ lat: 91, lng: 0 },
		{ lat: 89, lng: 0 },
		{ lat: 0, lng: 181 },
		{ lat: Number.NaN, lng: 0 },
	])('rejects center %j', (center) => {
		expect(() => gridPoints(center, 3, 1)).toThrow('Invalid center');
	});
});

describe('offsetPoint', () => {
	it('moves the given distance along each axis', () => {
		withinOnePercent(haversineKm(TORONTO, offsetPoint(TORONTO, 2, 0)), 2);
		withinOnePercent(haversineKm(TORONTO, offsetPoint(TORONTO, 0, -3)), 3);
	});
});
