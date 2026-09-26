// Minimal RFC 4180 CSV writing and parsing (quotes, commas, newlines, CRLF, BOM), so the calibration
// sheet survives a round trip through Excel / Google Sheets / Numbers without a dependency.

const needsQuoting = /[",\r\n]/;

export const toCsvField = (value: string | number | null | undefined): string => {
	const text = value === null || value === undefined ? '' : String(value);
	return needsQuoting.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const toCsv = (header: string[], rows: (string | number | null | undefined)[][]): string =>
	[header, ...rows].map((row) => row.map(toCsvField).join(',')).join('\n') + '\n';

/** Parses CSV text into rows of fields. Handles quoted fields, escaped quotes, CRLF and a UTF-8 BOM. */
export const parseCsv = (input: string): string[][] => {
	const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input; // strip a UTF-8 BOM
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let inQuotes = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (inQuotes) {
			if (ch === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				field += ch;
			}
		} else if (ch === '"') {
			inQuotes = true;
		} else if (ch === ',') {
			row.push(field);
			field = '';
		} else if (ch === '\n' || ch === '\r') {
			if (ch === '\r' && text[i + 1] === '\n') i++;
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else {
			field += ch;
		}
	}
	if (field.length > 0 || row.length > 0) {
		row.push(field);
		rows.push(row);
	}
	return rows.filter((r) => r.some((f) => f.trim() !== ''));
};

/** CSV rows as objects keyed by the header row. */
export const parseCsvObjects = (input: string): Record<string, string>[] => {
	const [header, ...rows] = parseCsv(input);
	if (!header) return [];
	const keys = header.map((h) => h.trim());
	return rows.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
};
