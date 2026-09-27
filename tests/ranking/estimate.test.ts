import { countKeywords, estimateCalls, estimateDuration, uniquePointCount } from '../../src/ranking/estimate';

describe('estimateCalls', () => {
	it('2 keywords, 3×3, 1 km: 13 points → 26–78 IDs-only; Map Ranking at 5 points → 10 Pro', () => {
		expect(estimateCalls(2, 3, { spacingKm: 1 })).toEqual({
			keywords: 2,
			gridSize: 3,
			points: 13,
			samples: 1,
			mapPoints: 5,
			idsOnly: { min: 26, max: 78, maxWithRetries: 156 },
			pro: { min: 10, max: 10, maxWithRetries: 20 },
			details: { min: 0, max: 0, maxWithRetries: 0 },
			total: { min: 36, max: 88, maxWithRetries: 176 },
		});
		expect(estimateCalls(2, 3, { spacingKm: 1, mapPoints: 1 }).pro.max).toBe(2);
	});

	it.each([
		[3, 13],
		[5, 29],
		[7, 53],
	])('%i×%i grid + tracker shares only the center: %i points', (size, points) => {
		expect(uniquePointCount(size, { spacingKm: 1, offsetKm: 1.5 })).toBe(points);
	});

	it('largest run (20 keywords, 7×7, 1 km): 1,060–3,180 IDs-only calls, 100 Pro; with 5 samples 15,900 (under the 16,000 cap)', () => {
		const e = estimateCalls(20, 7, { spacingKm: 1 });
		expect(e.points).toBe(53);
		expect(e.idsOnly).toEqual({ min: 1060, max: 3180, maxWithRetries: 6360 });
		expect(e.pro).toEqual({ min: 100, max: 100, maxWithRetries: 200 });
		const max = estimateCalls(20, 7, { spacingKm: 1, samples: 5 });
		expect(max.idsOnly.max).toBe(15900);
		expect(max.idsOnly.max).toBeLessThanOrEqual(16000);
	});

	it('expected duration: calls at the rate, or the sample spacing when longer', () => {
		const e = estimateCalls(10, 5, { spacingKm: 1 }); // 870 IDs-only + 50 Pro
		expect(estimateDuration(e, { qps: 8 })).toBe(115000); // ~2 min
		const three = estimateCalls(10, 5, { spacingKm: 1, samples: 3 });
		expect(Math.round(estimateDuration(three, { qps: 8, samples: 3, spacingSec: 60 }) / 1000)).toBe(333); // ~5.5 min
		expect(Math.round(estimateDuration(three, { qps: 8, samples: 3, spacingSec: 600 }) / 60000)).toBe(22);
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
		expect(e.total.min).toBe(37);
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
