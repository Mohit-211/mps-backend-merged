import { Types } from 'mongoose';
import { CitationStatus, CUSTOMER_FACING_ACTOR, NapField } from '../../citations/constants';
import { CitationStatusLog, Directory, ICitationStatusLog, ILocation } from '../../models';
import { paging } from './common';
import { expectedNap } from './entries.service';
import { loadHealthEntries } from './summary';

// The customer side of citations (Phase 16): read-only for every organization role (a client_user only
// for its clients' locations; access is checked by loadOwnedLocation). No admin identities or internal
// notes: history rows say "MyPageSEO team".

const RECENT_CHANGES = 10;

/** The order the table groups statuses in: problems first. */
const STATUS_ORDER: CitationStatus[] = ['nap_wrong', 'duplicate', 'not_found', 'pending', 'submitted', 'not_checked', 'live_correct', 'removed'];

const changeView = (r: ICitationStatusLog, names: Map<string, { name: string; type: string }>) => ({
	at: r.at,
	directory: { name: names.get(String(r.directory_id))?.name ?? '(directory)', type: names.get(String(r.directory_id))?.type ?? null },
	action: r.action,
	from: r.from,
	to: r.to,
	changed_fields: r.changed_fields.filter((f) => f !== 'notes'),
	by: CUSTOMER_FACING_ACTOR,
});

const directoryNames = async (rows: ICitationStatusLog[]) => {
	const ids = [...new Set(rows.map((r) => String(r.directory_id)))];
	const dirs = ids.length ? await Directory.find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } }).select({ name: 1, type: 1 }).lean<{ _id: Types.ObjectId; name: string; type: string }[]>() : [];
	return new Map(dirs.map((d) => [String(d._id), { name: d.name, type: d.type }]));
};

/** Only changes that customers see: not notes-only edits. */
const visibleChanges = { $nor: [{ action: 'updated', changed_fields: ['notes'] }] };

export const createCitationCustomerService = () => {
	const overview = async (location: Pick<ILocation, '_id' | 'name' | 'address' | 'mobile' | 'website_URL'>, query: { status?: CitationStatus } = {}) => {
		const { entries, directories, health } = await loadHealthEntries(location._id);
		if (!entries.length) return { available: false as const, reason: 'no_citations_yet' };
		const nap = expectedNap(location);
		const checked = entries.map((e) => e.last_checked_at).filter((d): d is Date => Boolean(d));
		const recent = await CitationStatusLog.find({ location_id: location._id, ...visibleChanges }).sort({ at: -1, _id: -1 }).limit(RECENT_CHANGES).lean<ICitationStatusLog[]>();
		const names = await directoryNames(recent);
		const rows = entries
			.filter((e) => !query.status || e.status === query.status)
			.map((e) => {
				const d = directories.get(String(e.directory_id));
				return {
					directory: { name: d?.name ?? '(directory)', url: d?.url ?? null, type: d?.type ?? null },
					status: e.status,
					nap_issues: (e.mismatch_fields ?? []).map((field: NapField) => ({ field, found: e.nap_found?.[field] ?? null, expected: nap[field] })),
					listing_url: e.listing_url ?? null,
					last_checked_at: e.last_checked_at ?? null,
				};
			})
			.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.directory.name.localeCompare(b.directory.name));
		return {
			available: true as const,
			health: { score: health.score, grade: health.grade, coverage: health.coverage, total: health.total },
			counts: health.counts,
			last_checked_at: checked.length ? new Date(Math.max(...checked.map((d) => d.getTime()))) : null,
			recent_changes: recent.map((r) => changeView(r, names)),
			citations: rows,
		};
	};

	const changes = async (locationId: Types.ObjectId, query: { page?: number; limit?: number }) => {
		const { page, limit } = paging(query, 25);
		const filter = { location_id: locationId, ...visibleChanges };
		const [rows, total] = await Promise.all([
			CitationStatusLog.find(filter).sort({ at: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean<ICitationStatusLog[]>(),
			CitationStatusLog.countDocuments(filter),
		]);
		const names = await directoryNames(rows);
		return { changes: rows.map((r) => changeView(r, names)), page, limit, total };
	};

	return { overview, changes };
};

export const citationCustomerService = createCitationCustomerService();
