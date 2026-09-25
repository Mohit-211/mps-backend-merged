// Shared types for the ranking engine (CLAUDE.md §4).

export interface GeoPoint {
	lat: number;
	lng: number;
}

export type TrackerLabel = 'C' | 'N' | 'S' | 'E' | 'W';

export interface TrackerPoint extends GeoPoint {
	label: TrackerLabel;
}

/** Grid point in heatmap order: row 0 is the northernmost row, col 0 the westernmost column. */
export interface GridPoint extends GeoPoint {
	row: number;
	col: number;
}

export type GridSize = 3 | 5 | 7;

export type RankStatus = 'ok' | 'not_found' | 'error';

/** Rank of one target at one sample point. rank is 1–60 when status is 'ok', otherwise null. */
export interface RankCell {
	rank: number | null;
	status: RankStatus;
}

export type RankBucket = 'pack' | 'visible' | 'low' | 'invisible' | 'not_found' | 'error';

export type TargetKey = 'self' | `competitor_${number}`;

/** A business whose rank is measured: the client ('self') or a competitor. */
export interface Target {
	key: TargetKey;
	placeId: string;
}

export type ChangeLabel = 'improved' | 'declined' | 'unchanged' | 'entered_top_60' | 'dropped_out_of_top_60';

export interface Change {
	/** previous − current (positive = improved); null when not comparable or when a label replaces the number. */
	change: number | null;
	changeLabel: ChangeLabel | null;
}

/** Per keyword and target, over its non-error cells. All values are null when every cell is an error. */
export interface KeywordSummary {
	avgRank: number | null;
	foundRate: number | null;
	top3Rate: number | null;
}
