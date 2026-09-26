/*
 * Scores a filled-in calibration sheet (no API calls, no database):
 *
 *   npm run calibrate:score -- docs/calibration/<file>.csv [--tracker-only]
 *
 * Rows with a blank manual_rank are skipped. --tracker-only scores the tracker rows (C/N/S/E/W) only.
 * PASS when ≥ 70% of points are within 2 positions AND top-3 overlap is ≥ 60%.
 */
import fs from 'fs';
import { parseCsvObjects } from '../calibration/csv';
import { PASS_TOP3_PCT, PASS_WITHIN_PCT, SheetRow, WITHIN, scoreSheet } from '../calibration/score';

const show = (value: number | null): string => (value === null ? 'n/a' : `${value}%`);

const main = (): number => {
	const args = process.argv.slice(2);
	const trackerOnly = args.includes('--tracker-only');
	const file = args.find((a) => !a.startsWith('--'));
	if (!file || !fs.existsSync(file)) {
		process.stderr.write('Usage: npm run calibrate:score -- <calibration csv> [--tracker-only]\n');
		return 2;
	}
	const rows = parseCsvObjects(fs.readFileSync(file, 'utf8')) as unknown as SheetRow[];
	const s = scoreSheet(rows, { trackerOnly });

	const lines = [
		`Calibration: ${file}${trackerOnly ? ' (tracker rows only)' : ''}`,
		`Points scored:                    ${s.scored} (skipped: ${s.skipped.noManual} without manual rank, ${s.skipped.apiError} API error, ${s.skipped.duplicate} duplicate center${trackerOnly ? `, ${s.skipped.excluded} grid rows excluded` : ''})`,
		...s.byGroup.map((g) => `  ${g.keyword} / ${g.point_type}: ${g.scored} of ${g.total} scored`),
		`Within ${WITHIN} positions:               ${show(s.withinPct)}   (pass ≥ ${PASS_WITHIN_PCT}%)`,
		`Found on Maps, 60+ in API:        ${show(s.mapsFoundApiNotPct)}`,
		`Found in API, not found on Maps:  ${show(s.apiFoundMapsNotPct)}`,
		`Top-3 overlap:                    ${show(s.top3.overlapPct)} over ${s.top3.rows} rows   (pass ≥ ${PASS_TOP3_PCT}%)`,
		'',
		`VERDICT: ${s.verdict}${s.reasons.length ? ` (${s.reasons.join('; ')})` : ''}`,
	];
	if (s.worst.length > 0) {
		lines.push('', 'Worst rows:');
		for (const w of s.worst) {
			lines.push(`  ${w.keyword} @ ${w.point}: api ${w.api_rank} vs maps ${w.manual_rank} (gap ${w.gap})`);
		}
	}
	process.stdout.write(`${lines.join('\n')}\n`);
	return 0;
};

process.exit(main());
