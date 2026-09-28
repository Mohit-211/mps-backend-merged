import httpStatus from 'http-status';
import { Types } from 'mongoose';
import { CitationCountry } from '../../citations/constants';
import { matchDirectories } from '../../citations/match';
import { citationCountry, regionCode } from '../../citations/regions';
import { BusinessCategory, CitationStatusLog, Directory, DirectoryCategory, GbpProfileSnapshot, IDirectory, ILocation, Location, LocationCitation } from '../../models';
import { apiErrorWithData } from '../../utils';
import { AdminActor, escapeRegex, oid } from './common';
import { updateCitationSummary } from './summary';

// Directory suggestions (Phase 16): at onboarding completion and on an admin action, every active
// directory matching the location's country, region and business-category groups is added as
// `not_checked`. Suggestions never remove anything and never re-add an entry an admin took off the list.

type Id = Types.ObjectId | string;

/** Used in history rows when the suggestion ran automatically (onboarding), not by an admin. */
export const SYSTEM_ACTOR: AdminActor = { id: '', name: 'Automatic suggestion' };

export interface SuggestResult {
	country: CitationCountry | null;
	region: string | null;
	/** The location's business categories that were looked up. */
	business_categories: string[];
	/** Directory-category groups the location belongs to. */
	category_groups: { id: string; name: string }[];
	/** False when no group matched: only directories without categories were suggested. */
	category_matched: boolean;
	dry_run: boolean;
	added: { directory_id: string; name: string; type: string }[];
	already_listed: number;
	reason?: 'unsupported_country';
}

const usable = (v: string | null | undefined): string | null => {
	const t = (v ?? '').trim();
	return t && t.toLowerCase() !== 'n/a' ? t : null;
};

/** The location's business categories (the stored one, plus the GBP primary / additional ones when synced). */
export const locationBusinessCategories = async (location: Pick<ILocation, '_id' | 'business_category'>): Promise<string[]> => {
	const snapshot = await GbpProfileSnapshot.findOne({ location_id: location._id, is_latest: true }).select({ primary_category: 1, additional_categories: 1 }).lean<{ primary_category: string | null; additional_categories: string[] }>();
	const names = [location.business_category, snapshot?.primary_category, ...(snapshot?.additional_categories ?? [])].map(usable).filter((v): v is string => Boolean(v));
	const seen = new Set<string>();
	return names.filter((n) => (seen.has(n.toLowerCase()) ? false : (seen.add(n.toLowerCase()), true)));
};

export const categoryGroupsFor = async (names: string[]): Promise<{ id: string; name: string }[]> => {
	if (!names.length) return [];
	const cats = await BusinessCategory.find({ name: { $in: names.map((n) => new RegExp(`^${escapeRegex(n)}$`, 'i')) } }).select({ _id: 1 }).lean<{ _id: Types.ObjectId }[]>();
	if (!cats.length) return [];
	const groups = await DirectoryCategory.find({ is_active: true, business_category_ids: { $in: cats.map((c) => c._id) } }).select({ name: 1 }).sort({ name: 1 }).lean<{ _id: Types.ObjectId; name: string }[]>();
	return groups.map((g) => ({ id: String(g._id), name: g.name }));
};

export const logActor = (actor: AdminActor) => ({ admin_id: actor.id ? oid(actor.id) : null, name: actor.name });

export const suggestForLocation = async (locationId: Id, opts: { dryRun?: boolean; actor?: AdminActor } = {}): Promise<SuggestResult> => {
	const actor = opts.actor ?? SYSTEM_ACTOR;
	const location = await Location.findById(locationId).lean<ILocation>();
	if (!location) throw apiErrorWithData(httpStatus.NOT_FOUND, 'Location not found.', { reason: 'not_found' });
	if (!location.organization_id) throw apiErrorWithData(httpStatus.CONFLICT, 'The location has no organization (run migrate:organizations).', { reason: 'no_organization' });
	const country = citationCountry(location.country);
	const names = await locationBusinessCategories(location);
	const base = { business_categories: names, dry_run: Boolean(opts.dryRun), added: [], already_listed: 0 };
	if (!country) return { ...base, country: null, region: null, category_groups: [], category_matched: false, reason: 'unsupported_country' };
	const region = regionCode(country, location.state);
	const groups = await categoryGroupsFor(names);
	const directories = await Directory.find({ is_active: true, countries: country }).lean<IDirectory[]>();
	const matched = matchDirectories(
		{ country, region, categoryIds: groups.map((g) => g.id) },
		directories.map((d) => ({ id: String(d._id), is_active: d.is_active, countries: d.countries, regions: d.regions, category_ids: d.category_ids.map(String) })),
	);
	const existing = new Set((await LocationCitation.find({ location_id: location._id }).select({ directory_id: 1 }).lean<{ directory_id: Types.ObjectId }[]>()).map((e) => String(e.directory_id)));
	const byId = new Map(directories.map((d) => [String(d._id), d]));
	const toAdd = matched.filter((id) => !existing.has(id));
	const result: SuggestResult = {
		...base,
		country,
		region,
		category_groups: groups,
		category_matched: groups.length > 0,
		already_listed: matched.length - toAdd.length,
		added: toAdd.map((id) => ({ directory_id: id, name: byId.get(id)?.name ?? '', type: byId.get(id)?.type ?? 'general' })),
	};
	if (opts.dryRun || !toAdd.length) return result;

	const at = new Date();
	for (const directoryId of toAdd) {
		// Upsert on the unique (location, directory) key: a parallel suggestion can't create duplicates.
		const res = await LocationCitation.updateOne(
			{ location_id: location._id, directory_id: oid(directoryId) },
			{ $setOnInsert: { organization_id: location.organization_id, status: 'not_checked', source: 'suggested', added_by: actor.id ? oid(actor.id) : null, active: true } },
			{ upsert: true },
		);
		if (!res.upsertedId) continue;
		await CitationStatusLog.create({
			location_citation_id: res.upsertedId,
			location_id: location._id,
			organization_id: location.organization_id,
			directory_id: oid(directoryId),
			action: 'added',
			from: null,
			to: 'not_checked',
			changed_fields: [],
			note: 'Suggested from the business category and country',
			by: logActor(actor),
			at,
		});
	}
	await updateCitationSummary(location._id);
	return result;
};
