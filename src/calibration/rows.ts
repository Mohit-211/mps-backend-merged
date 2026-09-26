import { LeanRankRun, RankCellDoc } from '../models/rankRun.model';
import { displayRank } from '../ranking';

// Builds the calibration sheet for one completed RankRun (no API calls): one row per keyword ×
// sample point, with our rank for the client and a Google Maps link for the manual check.

export const CALIBRATION_HEADER = [
	'keyword',
	'point_type',
	'row',
	'col',
	'lat',
	'lng',
	'api_rank',
	'api_top3',
	'api_results',
	'maps_url',
	'manual_rank',
	'manual_top3',
	'notes',
];

export const NAME_SEPARATOR = ' | ';

export const mapsUrl = (keyword: string, lat: number, lng: number): string =>
	`https://www.google.com/maps/search/${encodeURIComponent(keyword)}/@${lat.toFixed(6)},${lng.toFixed(6)},14z`;

/**
 * Names for place IDs, taken from the run's Map Ranking lists (top 20 at the center, every keyword).
 * IDs that never appear there cannot be named without extra API calls: they are shown as
 * "(unknown: <id>)" and the scorer skips those rows for the top-3 comparison.
 */
export const nameIndex = (run: Pick<LeanRankRun, 'mapList'>): Map<string, string> => {
	const names = new Map<string, string>();
	for (const section of run.mapList ?? []) {
		for (const result of section.results) if (result.name) names.set(result.place_id, result.name);
	}
	return names;
};

const top3Names = (ids: string[] | undefined, names: Map<string, string>): string =>
	(ids ?? []).map((id) => names.get(id) ?? `(unknown: ${id})`).join(NAME_SEPARATOR);

/** "17" = the whole list had 17 results; "20+" = paging stopped once the client was found. "" if the search failed. */
export const resultsLabel = (count: number | null | undefined, more: boolean | undefined): string =>
	count === null || count === undefined ? '' : `${count}${more ? '+' : ''}`;

const selfRank = (byTarget: Record<string, RankCellDoc>): string => {
	const cell = byTarget.self;
	return cell ? displayRank(cell as Parameters<typeof displayRank>[0]) : 'error';
};

export type CalibrationRow = (string | number)[];

export const buildCalibrationRows = (run: Pick<LeanRankRun, 'tracker' | 'grid' | 'mapList'>): CalibrationRow[] => {
	const names = nameIndex(run);
	const rows: CalibrationRow[] = [];
	for (const section of run.tracker) {
		for (const cell of section.cells) {
			// Tracker points have no grid position: `row` holds the label (C = center, N, S, E, W).
			rows.push([
				section.keyword,
				'tracker',
				cell.point.label,
				'',
				cell.point.lat.toFixed(6),
				cell.point.lng.toFixed(6),
				selfRank(cell.byTarget),
				top3Names(cell.top3, names),
				resultsLabel(cell.result_count, cell.more_results),
				mapsUrl(section.keyword, cell.point.lat, cell.point.lng),
				'',
				'',
				'',
			]);
		}
		const grid = run.grid.find((g) => g.keyword === section.keyword);
		for (const point of grid?.points ?? []) {
			rows.push([
				section.keyword,
				'grid',
				point.row,
				point.col,
				point.lat.toFixed(6),
				point.lng.toFixed(6),
				selfRank(point.byTarget),
				top3Names(point.top3, names),
				resultsLabel(point.result_count, point.more_results),
				mapsUrl(section.keyword, point.lat, point.lng),
				'',
				'',
				'',
			]);
		}
	}
	return rows;
};

export const calibrationFileName = (runAt: Date, locationName: string, city?: string, suffix?: string): string => {
	const slug = `${locationName} ${city ?? ''} ${suffix ?? ''}`
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return `${runAt.toISOString().slice(0, 10)}-${slug}.csv`;
};
