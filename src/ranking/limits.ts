import config from '../configs/config';

// Development guard (CLAUDE.md §2): real Google calls during development use at most
// RANK_DEV_MAX_KEYWORDS keywords per run. Other environments are not capped here.

export interface DevCapResult<T> {
	keywords: T[];
	capped: boolean;
	/** The cap applied, or null outside development. */
	cap: number | null;
}

export const applyDevKeywordCap = <T>(
	keywords: T[],
	env: string = config.essentials.env,
	cap: number = config.ranking.devMaxKeywords,
): DevCapResult<T> => {
	if (env !== 'development') return { keywords, capped: false, cap: null };
	return { keywords: keywords.slice(0, cap), capped: keywords.length > cap, cap };
};
