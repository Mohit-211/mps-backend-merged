import httpStatus from 'http-status';
import { Types } from 'mongoose';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { CITATION_COUNTRIES, CitationCountry, DIRECTORY_TYPES, DirectoryType } from '../../citations/constants';
import { Directory, DirectoryCategory, IDirectory } from '../../models';
import { apiErrorWithData } from '../../utils';
import { AdminActor, actorOid, domainOf, oid } from './common';
import { directoryProblems } from './directory.service';

// Directory CSV import / export (Phase 16). Columns: name, url, type, countries, categories, regions,
// authority, notes, active. Lists are pipe-separated; categories are directory-category slugs; the
// upsert key is the domain of `url`. Import is all-or-nothing (any error → nothing applied) and never
// deletes directories missing from the file. Export neutralises spreadsheet formulas.

export const CSV_COLUMNS = ['name', 'url', 'type', 'countries', 'categories', 'regions', 'authority', 'notes', 'active'] as const;
const REQUIRED_COLUMNS = ['name', 'url', 'type', 'countries'];
export const MAX_IMPORT_ROWS = 2000;

export interface ImportError {
	/** The line in the file (the header is line 1). */
	row: number;
	field: string;
	message: string;
}

export interface ImportResult {
	dry_run: boolean;
	applied: boolean;
	rows: number;
	created: number;
	updated: number;
	unchanged: number;
	errors: ImportError[];
}

interface ParsedRow {
	line: number;
	domain: string;
	name: string;
	url: string;
	type: DirectoryType;
	category_ids: string[];
	countries: CitationCountry[];
	regions: string[];
	authority: number | null;
	notes: string | null;
	is_active: boolean;
}

const list = (v: string | undefined): string[] =>
	(v ?? '')
		.split('|')
		.map((x) => x.trim())
		.filter(Boolean);

const sameSet = (a: string[], b: string[]): boolean => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

const unchanged = (row: ParsedRow, cur: IDirectory): boolean =>
	row.name === cur.name &&
	row.url === cur.url &&
	row.type === cur.type &&
	sameSet(row.category_ids, cur.category_ids.map(String)) &&
	sameSet(row.countries, cur.countries) &&
	sameSet(row.regions, cur.regions) &&
	row.authority === (cur.authority ?? null) &&
	row.notes === (cur.notes ?? null) &&
	row.is_active === cur.is_active;

/** Protects spreadsheet users: a cell starting with = + - @ (or a tab / CR) is prefixed with '. */
export const safeCell = (v: string): string => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

export const createDirectoryCsvService = () => {
	const importCsv = async (text: string, opts: { dryRun: boolean }, actor: AdminActor): Promise<ImportResult> => {
		let records: Record<string, string>[];
		let header: string[] = [];
		try {
			records = parse(text.replace(/^\uFEFF/, ''), {
				columns: (h: string[]) => (header = h.map((c) => c.trim().toLowerCase())),
				skip_empty_lines: true,
				trim: true,
			});
		} catch (err) {
			throw apiErrorWithData(httpStatus.BAD_REQUEST, `The CSV could not be read: ${(err as Error).message}`, { reason: 'invalid_csv' });
		}
		const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
		const unknown = header.filter((c) => c && !(CSV_COLUMNS as readonly string[]).includes(c));
		if (missing.length || unknown.length) {
			throw apiErrorWithData(httpStatus.BAD_REQUEST, `Header problem: ${[missing.length ? `missing ${missing.join(', ')}` : '', unknown.length ? `unknown ${unknown.join(', ')}` : ''].filter(Boolean).join('; ')}.`, {
				reason: 'invalid_csv_header',
				missing,
				unknown,
				expected: CSV_COLUMNS,
			});
		}
		if (records.length === 0) throw apiErrorWithData(httpStatus.BAD_REQUEST, 'The CSV has no rows.', { reason: 'empty_csv' });
		if (records.length > MAX_IMPORT_ROWS) {
			throw apiErrorWithData(httpStatus.BAD_REQUEST, `At most ${MAX_IMPORT_ROWS} rows per import.`, { reason: 'too_many_rows', max: MAX_IMPORT_ROWS });
		}

		const categories = await DirectoryCategory.find({}).select({ slug: 1 }).lean<{ _id: Types.ObjectId; slug: string }[]>();
		const categoryBySlug = new Map(categories.map((c) => [c.slug, String(c._id)]));
		const errors: ImportError[] = [];
		const rows: ParsedRow[] = [];
		const seen = new Map<string, number>();

		records.forEach((r, i) => {
			const line = i + 2;
			const err = (field: string, message: string) => errors.push({ row: line, field, message });
			const type = (r.type ?? '').toLowerCase();
			if (!(DIRECTORY_TYPES as readonly string[]).includes(type)) err('type', `type must be one of ${DIRECTORY_TYPES.join(', ')}`);
			const countries = list(r.countries).map((c) => c.toUpperCase());
			const badCountry = countries.find((c) => !(CITATION_COUNTRIES as readonly string[]).includes(c));
			if (badCountry) err('countries', `"${badCountry}" is not a supported country (US, CA)`);
			const slugs = list(r.categories).map((s) => s.toLowerCase());
			const unknownSlug = slugs.find((s) => !categoryBySlug.has(s));
			if (unknownSlug) err('categories', `unknown category "${unknownSlug}"`);
			const authorityRaw = (r.authority ?? '').trim();
			const authority = authorityRaw === '' ? null : Number(authorityRaw);
			if (authority !== null && !Number.isInteger(authority)) err('authority', 'authority must be empty or an integer 0–100');
			const activeRaw = (r.active ?? '').trim().toLowerCase();
			if (!['', 'true', 'false'].includes(activeRaw)) err('active', 'active must be true, false or empty');
			const parsed: ParsedRow = {
				line,
				domain: domainOf(r.url ?? '') ?? '',
				name: (r.name ?? '').trim(),
				url: (r.url ?? '').trim(),
				type: type as DirectoryType,
				category_ids: [...new Set(slugs.map((s) => categoryBySlug.get(s)).filter((x): x is string => Boolean(x)))],
				countries: [...new Set(countries)] as CitationCountry[],
				regions: [...new Set(list(r.regions).map((x) => x.toUpperCase()))],
				authority: authority !== null && Number.isInteger(authority) ? authority : null,
				notes: (r.notes ?? '').trim() || null,
				is_active: activeRaw !== 'false',
			};
			if ((DIRECTORY_TYPES as readonly string[]).includes(type) && !badCountry && !unknownSlug) {
				for (const p of directoryProblems(parsed)) err(p.field, p.message);
			}
			if (parsed.domain) {
				const first = seen.get(parsed.domain);
				if (first) err('url', `duplicate domain "${parsed.domain}" (also on line ${first})`);
				else seen.set(parsed.domain, line);
			}
			rows.push(parsed);
		});

		const result: ImportResult = { dry_run: opts.dryRun, applied: false, rows: rows.length, created: 0, updated: 0, unchanged: 0, errors };
		const existing = await Directory.find({ domain: { $in: rows.map((r) => r.domain).filter(Boolean) } }).lean<IDirectory[]>();
		const byDomain = new Map(existing.map((d) => [d.domain, d]));
		const writes: Parameters<typeof Directory.bulkWrite>[0] = [];
		for (const row of rows) {
			const cur = byDomain.get(row.domain);
			if (cur && unchanged(row, cur)) {
				result.unchanged += 1;
				continue;
			}
			if (cur) result.updated += 1;
			else result.created += 1;
			const fields = {
				name: row.name,
				url: row.url,
				type: row.type,
				category_ids: row.category_ids.map(oid),
				countries: row.countries,
				regions: row.regions,
				authority: row.authority,
				notes: row.notes,
				is_active: row.is_active,
				updated_by: actorOid(actor),
				updated_at: new Date(),
			};
			writes.push({
				updateOne: {
					filter: { domain: row.domain },
					update: { $set: fields, $setOnInsert: { domain: row.domain, created_by: actorOid(actor), created_at: new Date() } },
					upsert: true,
				},
			});
		}
		if (errors.length || opts.dryRun || writes.length === 0) return result;
		await Directory.bulkWrite(writes, { ordered: true });
		result.applied = true;
		return result;
	};

	const exportCsv = async (): Promise<string> => {
		const rows = await Directory.find({}).sort({ name: 1 }).lean<IDirectory[]>();
		const cats = await DirectoryCategory.find({}).select({ slug: 1 }).lean<{ _id: Types.ObjectId; slug: string }[]>();
		const slugOf = new Map(cats.map((c) => [String(c._id), c.slug]));
		const data = rows.map((d) =>
			[
				d.name,
				d.url,
				d.type,
				d.countries.join('|'),
				d.category_ids.map((id) => slugOf.get(String(id))).filter(Boolean).join('|'),
				d.regions.join('|'),
				d.authority === null || d.authority === undefined ? '' : String(d.authority),
				d.notes ?? '',
				d.is_active ? 'true' : 'false',
			].map(safeCell),
		);
		return `\uFEFF${stringify([[...CSV_COLUMNS], ...data])}`;
	};

	return { importCsv, exportCsv };
};

export const directoryCsvService = createDirectoryCsvService();
