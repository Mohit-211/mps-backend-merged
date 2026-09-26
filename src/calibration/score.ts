// Scores a filled-in calibration sheet: how closely our Places API ranks match what a person sees on
// Google Maps. Pure functions, unit-tested.
//
// Verdict: PASS when ≥ 70% of points are within 2 positions AND top-3 overlap is ≥ 60%.

export const WITHIN = 2;
export const PASS_WITHIN_PCT = 70;
export const PASS_TOP3_PCT = 60;

export type ParsedRank = number | 'not_found' | 'error';

/** "4" → 4; "60+", ">60", "not found", "nf", "-", or > 60 → 'not_found'; "error" → 'error'; blank → null. */
export const parseRank = (value: string | undefined): ParsedRank | null => {
	const text = (value ?? '').trim().toLowerCase();
	if (text === '') return null;
	if (text === 'error') return 'error';
	if (['60+', '>60', 'not found', 'notfound', 'nf', 'n/a', '-', 'none'].includes(text)) return 'not_found';
	const n = Number(text.replace(/^#/, ''));
	if (!Number.isFinite(n) || n < 1) return null;
	return n > 60 ? 'not_found' : Math.round(n);
};

const SUFFIXES = /\b(inc|ltd|llc|llp|corp|corporation|co|company|the|limited)\b/g;

/** Lower-case, drop punctuation and legal suffixes, collapse spaces. */
export const normaliseName = (name: string): string =>
	name
		.toLowerCase()
		.replace(/&/g, ' and ')
		.replace(/[^a-z0-9 ]+/g, ' ')
		.replace(SUFFIXES, ' ')
		.replace(/\s+/g, ' ')
		.trim();

/** Splits "A | B | C" (or ";"-separated) into normalised names. */
export const parseNames = (value: string | undefined): string[] =>
	(value ?? '')
		.split(/[|;]/)
		.map((n) => n.trim())
		.filter((n) => n.length > 0)
		.map((n) => (n.startsWith('(unknown:') ? n : normaliseName(n)))
		.filter((n) => n.length > 0);

/** Two names match when equal, or one contains the other (≥ 4 chars), e.g. "mypageseo" vs "mypageseo digital". */
export const namesMatch = (a: string, b: string): boolean =>
	a === b || (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a)));

/** Share (0–1) of our top 3 that appear in the manual top 3; null when not comparable. */
export const top3Overlap = (apiTop3: string[], manualTop3: string[]): number | null => {
	if (manualTop3.length === 0 || apiTop3.length === 0) return null;
	if (apiTop3.some((n) => n.startsWith('(unknown:'))) return null;
	const matched = apiTop3.filter((api) => manualTop3.some((manual) => namesMatch(api, manual))).length;
	return matched / Math.min(3, apiTop3.length);
};

export interface SheetRow {
	keyword: string;
	point_type: string;
	row: string;
	col: string;
	lat: string;
	lng: string;
	api_rank: string;
	api_top3: string;
	manual_rank: string;
	manual_top3: string;
	notes?: string;
}

export interface WorstRow {
	keyword: string;
	point: string;
	api_rank: string;
	manual_rank: string;
	gap: number;
}

export interface CalibrationScore {
	/** Rows with a manual rank and a usable API rank (duplicates of the same point counted once). */
	scored: number;
	skipped: { noManual: number; apiError: number; duplicate: number };
	withinPct: number | null;
	mapsFoundApiNotPct: number | null;
	apiFoundMapsNotPct: number | null;
	top3: { rows: number; overlapPct: number | null };
	verdict: 'PASS' | 'FAIL';
	reasons: string[];
	worst: WorstRow[];
}

const pct = (part: number, total: number): number | null =>
	total === 0 ? null : Math.round((part / total) * 1000) / 10;

const pointLabel = (r: SheetRow): string => (r.point_type === 'tracker' ? `tracker ${r.row}` : `grid ${r.row},${r.col}`);

/** Gap used to rank the worst rows: |difference|, with "not found" treated as 61. */
const gapOf = (api: number | 'not_found', manual: number | 'not_found'): number =>
	Math.abs((api === 'not_found' ? 61 : api) - (manual === 'not_found' ? 61 : manual));

export const scoreSheet = (rows: SheetRow[]): CalibrationScore => {
	const seen = new Set<string>();
	const skipped = { noManual: 0, apiError: 0, duplicate: 0 };
	let within = 0;
	let mapsFoundApiNot = 0;
	let apiFoundMapsNot = 0;
	let scored = 0;
	const overlaps: number[] = [];
	const worst: WorstRow[] = [];

	for (const r of rows) {
		const manual = parseRank(r.manual_rank);
		const api = parseRank(r.api_rank);
		if (manual === null || manual === 'error') {
			skipped.noManual++;
			continue;
		}
		if (api === null || api === 'error') {
			skipped.apiError++;
			continue;
		}
		// The grid center and tracker C are the same search: count the point once.
		const key = `${r.keyword.toLowerCase()}|${Number(r.lat).toFixed(5)}|${Number(r.lng).toFixed(5)}`;
		if (seen.has(key)) {
			skipped.duplicate++;
			continue;
		}
		seen.add(key);
		scored++;

		const gap = gapOf(api, manual);
		const bothFound = api !== 'not_found' && manual !== 'not_found';
		if ((bothFound && gap <= WITHIN) || (api === 'not_found' && manual === 'not_found')) within++;
		if (api === 'not_found' && manual !== 'not_found') mapsFoundApiNot++;
		if (api !== 'not_found' && manual === 'not_found') apiFoundMapsNot++;
		if (gap > 0) worst.push({ keyword: r.keyword, point: pointLabel(r), api_rank: r.api_rank, manual_rank: r.manual_rank, gap });

		const overlap = top3Overlap(parseNames(r.api_top3), parseNames(r.manual_top3));
		if (overlap !== null) overlaps.push(overlap);
	}

	const withinPct = pct(within, scored);
	const overlapPct =
		overlaps.length === 0 ? null : Math.round((overlaps.reduce((a, b) => a + b, 0) / overlaps.length) * 1000) / 10;
	const reasons: string[] = [];
	if (withinPct === null) reasons.push('no rows to score (fill in manual_rank)');
	else if (withinPct < PASS_WITHIN_PCT) reasons.push(`within-${WITHIN} is ${withinPct}% (< ${PASS_WITHIN_PCT}%)`);
	if (overlapPct === null) reasons.push('no rows with a comparable top 3 (fill in manual_top3; api_top3 must be fully named)');
	else if (overlapPct < PASS_TOP3_PCT) reasons.push(`top-3 overlap is ${overlapPct}% (< ${PASS_TOP3_PCT}%)`);

	return {
		scored,
		skipped,
		withinPct,
		mapsFoundApiNotPct: pct(mapsFoundApiNot, scored),
		apiFoundMapsNotPct: pct(apiFoundMapsNot, scored),
		top3: { rows: overlaps.length, overlapPct },
		verdict: reasons.length === 0 ? 'PASS' : 'FAIL',
		reasons,
		worst: worst.sort((a, b) => b.gap - a.gap).slice(0, 5),
	};
};
