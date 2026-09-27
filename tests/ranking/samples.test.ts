import { aggregateSamples, medianRank } from '../../src/ranking/samples';
import { decodeResultList, encodeResultLists } from '../../src/services/ranking/resultLists';
import { recommendSampling, summariseVariance } from '../../src/services/ranking/variance';

// Phase 12.5: sample aggregation, the compact result-list encoding and the variance-test analysis.

const ok = (rank: number) => ({ rank, status: 'ok' as const });
const nf = { rank: null, status: 'not_found' as const };
const err = { rank: null, status: 'error' as const };

describe('aggregateSamples', () => {
	it('median of the samples; not_found counts as 61; errors are left out', () => {
		expect(aggregateSamples([ok(3), ok(9), ok(4)])).toEqual({ rank: 4, status: 'ok', samples: [3, 9, 4], spread: 6 });
		expect(aggregateSamples([ok(3), nf, nf])).toEqual({ rank: null, status: 'not_found', samples: [3, 61, 61], spread: 58 });
		expect(aggregateSamples([ok(3), ok(5), err])).toEqual({ rank: 4, status: 'ok', samples: [3, 5, null], spread: 2 });
		expect(aggregateSamples([ok(3), ok(6), err])).toEqual({ rank: 5, status: 'ok', samples: [3, 6, null], spread: 3 }); // even: rounded up
		expect(aggregateSamples([ok(60), nf])).toMatchObject({ rank: null, status: 'not_found' }); // ceil(60.5) = 61
	});

	it('an error when more than half the samples failed; a single sample passes through', () => {
		expect(aggregateSamples([ok(3), err, err])).toEqual({ rank: null, status: 'error', samples: [3, null, null], spread: null });
		expect(aggregateSamples([ok(2), err])).toMatchObject({ rank: 2, status: 'ok' }); // half, not more than half
		expect(aggregateSamples([ok(7)])).toEqual({ rank: 7, status: 'ok', samples: [7], spread: null });
		expect(aggregateSamples([err])).toEqual({ rank: null, status: 'error', samples: [null], spread: null });
		expect(() => aggregateSamples([])).toThrow();
		expect(medianRank([5, 1, 3, 2])).toBe(3);
	});
});

describe('result lists', () => {
	it('dictionary + uint16 indexes round-trip; movedPlaceId is stored as the resolved ID; failures stay null', () => {
		const list = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `ChIJ${prefix}${String(i).padStart(23, '0')}` }));
		const a = list('a', 60);
		const b = [...list('a', 30), ...list('b', 30)];
		const moved = [{ id: 'ChIJold', movedPlaceId: 'ChIJnew' }];
		const { places, points } = encodeResultLists([
			{ point: 'C', sample: 0, entries: a },
			{ point: 'N', sample: 0, entries: b },
			{ point: 'S', sample: 0, entries: moved },
			{ point: 'E', sample: 0, entries: null },
		]);
		expect(places).toHaveLength(60 + 30 + 1);
		expect(decodeResultList(places, points[0].ids)).toEqual(a.map((e) => e.id));
		expect(decodeResultList(places, points[1].ids)).toEqual(b.map((e) => e.id));
		expect(decodeResultList(places, points[2].ids)).toEqual(['ChIJnew']);
		expect(points[3]).toEqual({ point: 'E', sample: 0, result_count: null, ids: null });
		expect(points[0]).toMatchObject({ result_count: 60 });
		expect(points[0].ids?.length).toBe(120);
	});
});

describe('variance analysis', () => {
	const cell = (samples: (number | null)[]) => {
		const values = samples.filter((v): v is number => v !== null);
		return { rank: values[0] ?? null, status: 'ok' as const, samples, spread: values.length > 1 ? Math.max(...values) - Math.min(...values) : null };
	};
	it('identical share and max spread per target; the recommendation follows Mohit\'s rule', () => {
		const pts = [
			{ keyword: 'k', point: 'C', byTarget: { self: cell([3, 3, 3]) } },
			{ keyword: 'k', point: 'N', byTarget: { self: cell([4, 6, 5]) } },
			{ keyword: 'k', point: 'S', byTarget: { self: cell([2, null, 2]) } },
		];
		expect(summariseVariance(pts, ['self'])).toEqual([{ target: 'self', points: 3, identical: 1, identical_pct: 50, max_spread: 2, with_errors: 1 }]);
		const none = [{ keyword: 'k', point: 'C', byTarget: { self: cell([3, 3, 3]) } }];
		expect(recommendSampling([0, 60, 600].map((spacingSec) => ({ spacingSec, summaries: summariseVariance(none, ['self']) })))).toEqual({ samples: 1, spacingSec: 0 });
		expect(
			recommendSampling([
				{ spacingSec: 600, summaries: summariseVariance(pts, ['self']) },
				{ spacingSec: 0, summaries: summariseVariance(none, ['self']) },
				{ spacingSec: 60, summaries: summariseVariance(pts, ['self']) },
			]),
		).toEqual({ samples: 3, spacingSec: 60 });
	});
});
