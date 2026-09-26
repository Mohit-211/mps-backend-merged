import { parseCsv, parseCsvObjects, toCsv, toCsvField } from '../../src/calibration/csv';

describe('calibration csv', () => {
	it('quotes only fields that need it', () => {
		expect(toCsvField('plain')).toBe('plain');
		expect(toCsvField('a,b')).toBe('"a,b"');
		expect(toCsvField('say "hi"')).toBe('"say ""hi"""');
		expect(toCsvField(null)).toBe('');
		expect(toCsvField(4)).toBe('4');
	});

	it('round-trips commas, quotes and newlines', () => {
		const rows = [['seo company', 'A | B, Inc | "C"', 'line1\nline2', '']];
		expect(parseCsv(toCsv(['k', 'names', 'notes', 'blank'], rows))).toEqual([['k', 'names', 'notes', 'blank'], ...rows]);
	});

	it('handles CRLF, a BOM, a missing final newline and blank lines', () => {
		const text = '﻿a,b\r\n1,2\r\n\r\n3,"4"';
		expect(parseCsv(text)).toEqual([
			['a', 'b'],
			['1', '2'],
			['3', '4'],
		]);
	});

	it('maps rows to header-keyed objects and trims values', () => {
		expect(parseCsvObjects('keyword , manual_rank\nseo company, 4 \nx\n')).toEqual([
			{ keyword: 'seo company', manual_rank: '4' },
			{ keyword: 'x', manual_rank: '' },
		]);
		expect(parseCsvObjects('')).toEqual([]);
	});
});
