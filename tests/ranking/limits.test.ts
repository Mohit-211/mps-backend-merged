import { applyDevKeywordCap } from '../../src/ranking/limits';

const keywords = ['plumber', 'drain cleaning', 'water heater repair', 'sewer line'];

describe('applyDevKeywordCap', () => {
	it('caps keywords in development', () => {
		expect(applyDevKeywordCap(keywords, 'development', 2)).toEqual({
			keywords: ['plumber', 'drain cleaning'],
			capped: true,
			cap: 2,
		});
	});

	it('reports no capping when already within the cap', () => {
		expect(applyDevKeywordCap(['plumber'], 'development', 2)).toEqual({ keywords: ['plumber'], capped: false, cap: 2 });
	});

	it.each(['production', 'test'])('does not cap in %s', (env) => {
		expect(applyDevKeywordCap(keywords, env, 2)).toEqual({ keywords, capped: false, cap: null });
	});

	it('defaults the cap to RANK_DEV_MAX_KEYWORDS (2)', () => {
		expect(applyDevKeywordCap(keywords, 'development').keywords).toHaveLength(2);
	});
});
