import { Types } from 'mongoose';
import { citationHealth, CitationHealth, HealthEntry } from '../../citations/health';
import { Directory, IDirectory, ILocation, ILocationCitation, Location, LocationCitation } from '../../models';

// Citation Health of one location (Phase 16), from its active entries, and the Location.summary fields
// the dashboards and the locations list read. Written after every citation change (write path).

type Id = Types.ObjectId | string;

export const loadHealthEntries = async (locationId: Id): Promise<{ entries: ILocationCitation[]; directories: Map<string, IDirectory>; health: CitationHealth }> => {
	const entries = await LocationCitation.find({ location_id: locationId, active: true }).lean<ILocationCitation[]>();
	const dirs = entries.length ? await Directory.find({ _id: { $in: entries.map((e) => e.directory_id) } }).lean<IDirectory[]>() : [];
	const directories = new Map(dirs.map((d) => [String(d._id), d]));
	const healthEntries: HealthEntry[] = entries.map((e) => {
		const d = directories.get(String(e.directory_id));
		return { status: e.status, directory_type: d?.type ?? 'general', authority: d?.authority ?? null };
	});
	return { entries, directories, health: citationHealth(healthEntries) };
};

export const updateCitationSummary = async (locationId: Id): Promise<CitationHealth> => {
	const { entries, health } = await loadHealthEntries(locationId);
	const checked = entries.map((e) => e.last_checked_at).filter((d): d is Date => Boolean(d));
	// The change is set when the score moves and kept while it stays the same, so the dashboard shows the last movement.
	const before = await Location.findById(locationId).select({ 'summary.citation_score': 1, 'summary.citation_score_change': 1 }).lean<Pick<ILocation, 'summary'>>();
	const old = before?.summary?.citation_score ?? null;
	const change =
		typeof health.score !== 'number' || typeof old !== 'number' ? null : health.score !== old ? health.score - old : (before?.summary?.citation_score_change ?? null);
	await Location.updateOne(
		{ _id: locationId },
		{
			$set: {
				'summary.citation_score': health.score,
				'summary.citation_grade': health.grade,
				'summary.citation_coverage': health.coverage,
				'summary.citation_counts': entries.length ? health.counts : null,
				'summary.citation_total': entries.length,
				'summary.citation_checked_at': checked.length ? new Date(Math.max(...checked.map((d) => d.getTime()))) : null,
				'summary.citation_score_change': change,
			},
		},
	);
	return health;
};
