// Public API of the ranking engine (CLAUDE.md §4, §8).
export * from './types';
export {
	GRID_SIZES,
	MIN_SPACING_KM,
	MAX_SPACING_KM,
	MIN_RADIUS_KM,
	MAX_RADIUS_KM,
	DEFAULT_TRACKER_OFFSET_KM,
	gridPoints,
	isGridSize,
	offsetPoint,
	trackerPoints,
	radiusFromSpacing,
	spacingFromRadius,
	trackerOffsetForRadius,
} from './points';
export { MAX_RANK, bucket, displayRank, toCell } from './rankCell';
export {
	NOT_FOUND_RANK_VALUE,
	avgRank,
	cellChange,
	foundRate,
	keywordChange,
	overallAvgRank,
	overallChange,
	round1,
	round2,
	summarise,
	top3Rate,
} from './metrics';
export {
	MAX_CONCURRENCY,
	cacheKey,
	createPool,
	createRankingEngine,
	normaliseKeyword,
	type EngineStats,
	type PointRanks,
	type RankingEngine,
	type RankingEngineOptions,
	type SearchError,
} from './engine';
export {
	countKeywords,
	estimateCalls,
	estimateDuration,
	uniquePointCount,
	type CallEstimate,
	type CallRange,
	type EstimateOptions,
	type DurationOptions,
} from './estimate';
export { NOT_FOUND_VALUE, aggregateSamples, medianRank, type SampledCell } from './samples';
export { regionFromCountry, type RegionCode } from './region';
export { applyDevKeywordCap, type DevCapResult } from './limits';
