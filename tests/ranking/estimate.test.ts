import { countKeywords, estimateCalls, uniquePointCount } from '../../src/ranking/estimate';

describe('estimateCalls', () => {
	it('first live test (2 keywords, 3×3, 1 km): 13 points → 26–78 IDs-only, 2 Pro', () => {
		expect(estimateCalls(2, 3, { spacingKm: 1 })).toEqual({
			keywords: 2,
			gridSize: 3,
			points: 13,
			idsOnly: { min: 26, max: 78, maxWithRetries: 156 },
			pro: { min: 2, max: 2, maxWithRetries: 4 },
			details: { min: 0, max: 0, maxWithRetries: 0 },
			total: { min: 28, max: 80, maxWithRetries: 160 },
		});
	});

	it.each([
		[3, 13],
		[5, 29],
		[7, 53],
	])('%i×%i grid + tracker shares only the center: %i points', (size, points) => {
		expect(uniquePointCount(size, { spacingKm: 1, offsetKm: 1.5 })).toBe(points);
	});

	it('largest run (20 keywords, 7×7, 1 km): 1,060–3,180 IDs-only calls, 20 Pro', () => {
		const e = estimateCalls(20, 7, { spacingKm: 1 });
		expect(e.points).toBe(53);
		expect(e.idsOnly).toEqual({ min: 1060, max: 3180, maxWithRetries: 6360 });
		expect(e.pro).toEqual({ min: 20, max: 20, maxWithRetries: 40 });
	});

	it('one keyword scales linearly', () => {
		expect(estimateCalls(1, 5, { spacingKm: 1 }).idsOnly).toEqual({ min: 29, max: 87, maxWithRetries: 174 });
	});

	it('counts tracker points that land on grid points once (engine cache)', () => {
		// 7×7 at 0.5 km: grid axis points at ±1.5 km coincide with N/S/E/W at 1.5 km → 49, not 53
		expect(uniquePointCount(7, { spacingKm: 0.5, offsetKm: 1.5 })).toBe(49);
		// 5×5 at 0.75 km: ±1.5 km is on the grid edge → 25
		expect(uniquePointCount(5, { spacingKm: 0.75, offsetKm: 1.5 })).toBe(25);
	});

	it('adds one Place Details call for center resolution when asked', () => {
		const e = estimateCalls(2, 3, { spacingKm: 1, includeCenterResolution: true });
		expect(e.details).toEqual({ min: 1, max: 1, maxWithRetries: 2 });
		expect(e.total.min).toBe(29);
	});

	it('accepts keyword lists and de-duplicates them like the engine', () => {
		expect(countKeywords(['Plumber', ' plumber ', 'Drain  Cleaning', 'drain cleaning', ''])).toBe(2);
		expect(estimateCalls(['Plumber', 'plumber'], 3, { spacingKm: 1 }).idsOnly.min).toBe(13);
	});

	it('handles zero keywords', () => {
		expect(estimateCalls(0, 3).total).toEqual({ min: 0, max: 0, maxWithRetries: 0 });
	});

	it('rejects invalid inputs', () => {
		expect(() => estimateCalls(2, 4)).toThrow('Invalid grid size');
		expect(() => estimateCalls(-1, 3)).toThrow('Invalid keyword count');
		expect(() => estimateCalls(1.5, 3)).toThrow('Invalid keyword count');
	});
});
