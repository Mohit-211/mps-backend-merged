import { Types } from 'mongoose';
import { CitationStatus } from '../../../citations/constants';
import { CitationStatusLog, Directory, ICitationStatusLog, ILocation, ReportRangeParam } from '../../../models';
import { expectedNap } from '../../citations/entries.service';
import { loadHealthEntries } from '../../citations/summary';
import { CitationReportData, Part, PartUnavailable } from '../types';

// Citation Report data (Phase 16): the location's Citation Health, its list, the NAP issues and the
// changes in the report's range, frozen into the snapshot. Our own data only (no Places content), and
// no admin identities or internal notes.

type Section = 'score' | 'table' | 'nap_issues' | 'changes';

const RANGE_DAYS: Record<ReportRangeParam, number> = { '28d': 28, '90d': 90, '12m': 365 };
const MAX_CHANGES = 50;
const STATUS_ORDER: CitationStatus[] = ['nap_wrong', 'duplicate', 'not_found', 'pending', 'submitted', 'not_checked', 'live_correct', 'removed'];

export const buildCitationData = async (
	location: Pick<ILocation, '_id' | 'name' | 'address' | 'mobile' | 'website_URL'>,
	range: ReportRangeParam,
	sections: readonly string[],
	at: Date,
): Promise<Part<CitationReportData>> => {
	const want = (s: Section) => sections.includes(s);
	const { entries, directories, health } = await loadHealthEntries(location._id);
	if (!entries.length) return { available: false, reason: 'no_citations_yet' } as PartUnavailable;
	const nameOf = (id: Types.ObjectId) => directories.get(String(id))?.name ?? '(directory)';
	const sorted = [...entries].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || nameOf(a.directory_id).localeCompare(nameOf(b.directory_id)));
	const data: CitationReportData = { available: true, as_of: at, range };
	if (want('score')) data.score = { score: health.score, grade: health.grade, coverage: health.coverage, total: health.total, counts: health.counts };
	if (want('table')) {
		data.table = sorted.map((e) => ({
			directory: nameOf(e.directory_id),
			type: directories.get(String(e.directory_id))?.type ?? 'general',
			status: e.status,
			listing_url: e.listing_url ?? null,
			last_checked_at: e.last_checked_at ?? null,
			nap_issues: e.mismatch_fields ?? [],
		}));
	}
	if (want('nap_issues')) {
		const expected = expectedNap(location);
		data.nap_issues = {
			expected,
			rows: sorted.flatMap((e) => (e.mismatch_fields ?? []).map((field) => ({ directory: nameOf(e.directory_id), field, found: e.nap_found?.[field] ?? null, expected: expected[field] }))),
		};
	}
	if (want('changes')) {
		const since = new Date(at.getTime() - RANGE_DAYS[range] * 86_400_000);
		const logs = await CitationStatusLog.find({ location_id: location._id, at: { $gte: since, $lte: at }, $nor: [{ action: 'updated', changed_fields: ['notes'] }] })
			.sort({ at: -1, _id: -1 })
			.limit(MAX_CHANGES)
			.lean<ICitationStatusLog[]>();
		const missing = [...new Set(logs.map((l) => String(l.directory_id)).filter((id) => !directories.has(id)))];
		const extra = missing.length ? await Directory.find({ _id: { $in: missing.map((id) => new Types.ObjectId(id)) } }).select({ name: 1 }).lean<{ _id: Types.ObjectId; name: string }[]>() : [];
		const extraName = new Map(extra.map((d) => [String(d._id), d.name]));
		data.changes = logs.map((l) => ({ at: l.at, directory: directories.get(String(l.directory_id))?.name ?? extraName.get(String(l.directory_id)) ?? '(directory)', action: l.action, from: l.from, to: l.to }));
	}
	return data;
};
