import { Types } from 'mongoose';
import { CitationStatus } from '../../citations/constants';
import { CitationStatusLog, ILocation, ILocationCitation, Location, LocationCitation } from '../../models';
import { napMismatches } from '../../utils/nap';
import { AdminActor } from './common';
import { expectedNap } from './entries.service';
import { suggestForLocation } from './suggest';
import { updateCitationSummary } from './summary';

// Demo citation lists (Phase 16) for `seed:demo-orgs`: a suggested list per location, then checks spread
// over the last 60 days with mixed statuses (a wrong phone on some listings, a few older than 90 days for
// the stale queue, one location mostly unchecked for the unchecked queue). Offline; our own data only.

const DAY = 86_400_000;
export const DEMO_CITATION_ACTOR: AdminActor = { id: '', name: 'Demo checker' };

/** Per location: a status for each listing in turn (null = leave not_checked), and how many days ago it was checked. */
const PATTERNS: { status: CitationStatus | null; daysAgo: number }[][] = [
	[
		{ status: 'live_correct', daysAgo: 5 },
		{ status: 'live_correct', daysAgo: 12 },
		{ status: 'nap_wrong', daysAgo: 8 },
		{ status: 'not_found', daysAgo: 20 },
		{ status: 'submitted', daysAgo: 3 },
		{ status: 'live_correct', daysAgo: 120 },
		{ status: 'duplicate', daysAgo: 30 },
		{ status: 'pending', daysAgo: 2 },
		{ status: null, daysAgo: 0 },
	],
	[
		{ status: 'live_correct', daysAgo: 40 },
		{ status: 'nap_wrong', daysAgo: 100 },
		{ status: 'live_correct', daysAgo: 15 },
		{ status: 'not_found', daysAgo: 9 },
		{ status: null, daysAgo: 0 },
		{ status: 'live_correct', daysAgo: 6 },
	],
	[
		{ status: 'live_correct', daysAgo: 25 },
		{ status: null, daysAgo: 0 },
		{ status: null, daysAgo: 0 },
		{ status: 'not_found', daysAgo: 45 },
	],
];

export const writeDemoCitations = async (locations: ILocation[], nowMs: number): Promise<{ entries: number; checked: number }> => {
	let entries = 0;
	let checked = 0;
	for (const [i, location] of locations.entries()) {
		await suggestForLocation(location._id, { actor: DEMO_CITATION_ACTOR });
		// The list was suggested 60 days ago.
		const added = new Date(nowMs - 60 * DAY);
		await LocationCitation.collection.updateMany({ location_id: location._id }, { $set: { created_at: added } });
		await CitationStatusLog.updateMany({ location_id: location._id, action: 'added' }, { $set: { at: added } });
		const fresh = (await Location.findById(location._id).lean<ILocation>()) as ILocation;
		const nap = expectedNap(fresh);
		const list = await LocationCitation.find({ location_id: location._id }).sort({ _id: 1 }).lean<ILocationCitation[]>();
		entries += list.length;
		const pattern = PATTERNS[i % PATTERNS.length];
		for (const [j, entry] of list.entries()) {
			const step = pattern[j % pattern.length];
			if (!step.status) continue;
			const at = new Date(nowMs - step.daysAgo * DAY);
			const found =
				step.status === 'nap_wrong'
					? { name: nap.name, address: nap.address, phone: '(416) 555-0199', website: nap.website }
					: step.status === 'live_correct' || step.status === 'duplicate'
						? { name: nap.name, address: nap.address, phone: nap.phone, website: nap.website }
						: { name: null, address: null, phone: null, website: null };
			const listed = step.status === 'live_correct' || step.status === 'nap_wrong' || step.status === 'duplicate';
			await LocationCitation.updateOne(
				{ _id: entry._id },
				{
					$set: {
						status: step.status,
						nap_found: found,
						mismatch_fields: napMismatches(nap, found),
						listing_url: listed ? `https://listing.example/${String(entry._id).slice(-6)}` : null,
						last_checked_at: at,
						checked_by: null,
					},
				},
			);
			await CitationStatusLog.create({
				location_citation_id: entry._id,
				location_id: location._id,
				organization_id: entry.organization_id,
				directory_id: entry.directory_id,
				action: 'status_changed',
				from: 'not_checked',
				to: step.status,
				changed_fields: listed ? ['status', 'listing_url', 'nap_found'] : ['status'],
				note: null,
				by: { admin_id: null, name: DEMO_CITATION_ACTOR.name },
				at,
			});
			checked += 1;
		}
		await updateCitationSummary(location._id as Types.ObjectId);
	}
	return { entries, checked };
};
