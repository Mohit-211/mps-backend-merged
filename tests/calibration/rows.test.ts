import { CALIBRATION_HEADER, buildCalibrationRows, calibrationFileName, mapsUrl } from '../../src/calibration/rows';
import { LeanRankRun } from '../../src/models/rankRun.model';

type RunPart = Pick<LeanRankRun, 'tracker' | 'grid' | 'mapList'>;

const ok = (rank: number) => ({ rank, status: 'ok' as const });
const notFound = { rank: null, status: 'not_found' as const };

const run = {
	tracker: [
		{
			keyword: 'seo company',
			cells: [
				{ point: { label: 'C', lat: 45.9636, lng: -66.6431 }, byTarget: { self: ok(2) }, top3: ['p1', 'self', 'p3'] },
				{ point: { label: 'N', lat: 45.977, lng: -66.6431 }, byTarget: { self: notFound }, top3: ['p1', 'px'] },
			],
			summary: {},
		},
	],
	grid: [
		{
			keyword: 'seo company',
			size: 3,
			spacing_km: 1,
			points: [{ row: 0, col: 1, lat: 45.9726, lng: -66.6431, byTarget: { self: { rank: null, status: 'error' } }, top3: [] }],
			summary: {},
		},
	],
	mapList: [
		{
			keyword: 'seo company',
			results: [
				{ rank: 1, place_id: 'p1', name: 'Alpha SEO', is_self: false },
				{ rank: 2, place_id: 'self', name: 'MyPageSEO', is_self: true },
				{ rank: 3, place_id: 'p3', name: 'Gamma, Inc', is_self: false },
			],
		},
	],
} as unknown as RunPart;

describe('calibration rows', () => {
	it('builds the Maps search link at the point', () => {
		expect(mapsUrl('seo company', 45.9636, -66.6431)).toBe(
			'https://www.google.com/maps/search/seo%20company/@45.963600,-66.643100,14z',
		);
	});

	it('writes one row per keyword × point, tracker first, with ranks and named top 3', () => {
		const rows = buildCalibrationRows(run);
		expect(rows).toHaveLength(3);
		rows.forEach((r) => expect(r).toHaveLength(CALIBRATION_HEADER.length));
		expect(rows[0].slice(0, 8)).toEqual([
			'seo company',
			'tracker',
			'C',
			'',
			'45.963600',
			'-66.643100',
			'2',
			'Alpha SEO | MyPageSEO | Gamma, Inc',
		]);
		expect(rows[1][6]).toBe('60+');
		expect(rows[1][7]).toBe('Alpha SEO | (unknown: px)');
		expect(rows[2].slice(1, 4)).toEqual(['grid', 0, 1]);
		expect(rows[2][6]).toBe('error');
		expect(rows[2].slice(9)).toEqual(['', '', '']);
	});

	it('names the file by run date and location', () => {
		expect(calibrationFileName(new Date('2026-09-26T10:00:00Z'), 'MyPageSEO', 'Fredericton')).toBe(
			'2026-09-26-mypageseo-fredericton.csv',
		);
	});
});
