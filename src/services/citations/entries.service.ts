import httpStatus from 'http-status';
import { Types } from 'mongoose';
import { CitationLogAction, CitationStatus, NapField } from '../../citations/constants';
import { CitationHealth } from '../../citations/health';
import { CitationStatusLog, Client, Directory, ICitationStatusLog, IDirectory, ILocation, ILocationCitation, Location, LocationCitation, NapFound, Organization } from '../../models';
import { apiErrorWithData } from '../../utils';
import { napMismatches } from '../../utils/nap';
import { AdminActor, oid, paging } from './common';
import { categoryGroupsFor, locationBusinessCategories, logActor } from './suggest';
import { loadHealthEntries, updateCitationSummary } from './summary';

// A location's citation list (Phase 16), for platform admins: the list with the location's NAP and
// score, adding and taking off directories, recording checks (status, listing URL, NAP found) and the
// history. Every change writes one CitationStatusLog row and refreshes Location.summary.

type Id = Types.ObjectId | string;

export interface EntryUpdateInput {
	status?: CitationStatus;
	listing_url?: string | null;
	nap_found?: Partial<NapFound>;
	notes?: string | null;
	/** "Checked, no change": only sets last_checked_at / checked_by. */
	checked?: boolean;
	/** Accept `live_correct` although the NAP found differs. */
	confirm?: boolean;
	/** A note for the history row. */
	note?: string | null;
}

export interface EntryView {
	id: string;
	directory: { id: string; name: string; url: string; domain: string; type: string; authority: number | null; is_active: boolean };
	status: CitationStatus;
	listing_url: string | null;
	nap_found: NapFound;
	mismatch_fields: NapField[];
	notes: string | null;
	last_checked_at: Date | null;
	checked_by: string | null;
	source: string;
	active: boolean;
	created_at: Date;
	updated_at: Date;
}

const blank = (v: string | null | undefined): string | null => {
	const t = (v ?? '').trim();
	return t && t.toLowerCase() !== 'n/a' ? t : null;
};

/** The NAP a listing should show: the location's own name, address, phone and website. */
export const expectedNap = (l: Pick<ILocation, 'name' | 'address' | 'mobile' | 'website_URL'>) => ({
	name: blank(l.name),
	address: blank(l.address),
	phone: blank(l.mobile),
	website: blank(l.website_URL),
});

export const entryView = (e: ILocationCitation, d: IDirectory | undefined): EntryView => ({
	id: String(e._id),
	directory: d
		? { id: String(d._id), name: d.name, url: d.url, domain: d.domain, type: d.type, authority: d.authority ?? null, is_active: d.is_active }
		: { id: String(e.directory_id), name: '(deleted directory)', url: '', domain: '', type: 'general', authority: null, is_active: false },
	status: e.status,
	listing_url: e.listing_url ?? null,
	nap_found: { name: e.nap_found?.name ?? null, address: e.nap_found?.address ?? null, phone: e.nap_found?.phone ?? null, website: e.nap_found?.website ?? null },
	mismatch_fields: e.mismatch_fields ?? [],
	notes: e.notes ?? null,
	last_checked_at: e.last_checked_at ?? null,
	checked_by: e.checked_by ? String(e.checked_by) : null,
	source: e.source,
	active: e.active,
	created_at: e.created_at,
	updated_at: e.updated_at,
});

const healthView = (h: CitationHealth) => ({ score: h.score, grade: h.grade, coverage: h.coverage, counts: h.counts, scored: h.scored, total: h.total });

const locationOr404 = async (locationId: Id): Promise<ILocation> => {
	const location = await Location.findById(locationId).lean<ILocation>();
	if (!location) throw apiErrorWithData(httpStatus.NOT_FOUND, 'Location not found.', { reason: 'not_found' });
	if (!location.organization_id) throw apiErrorWithData(httpStatus.CONFLICT, 'The location has no organization (run migrate:organizations).', { reason: 'no_organization' });
	return location;
};

const entryOr404 = async (entryId: Id): Promise<ILocationCitation> => {
	const entry = await LocationCitation.findById(entryId).lean<ILocationCitation>();
	if (!entry) throw apiErrorWithData(httpStatus.NOT_FOUND, 'Citation entry not found.', { reason: 'not_found' });
	// Entries of a deleted location are frozen with it.
	if (!(await Location.exists({ _id: entry.location_id }))) throw apiErrorWithData(httpStatus.NOT_FOUND, 'Citation entry not found.', { reason: 'not_found' });
	return entry;
};

const writeLog = (entry: Pick<ILocationCitation, '_id' | 'location_id' | 'organization_id' | 'directory_id'>, row: { action: CitationLogAction; from: CitationStatus | null; to: CitationStatus | null; changed_fields?: string[]; note?: string | null }, actor: AdminActor, at: Date) =>
	CitationStatusLog.create({
		location_citation_id: entry._id,
		location_id: entry.location_id,
		organization_id: entry.organization_id,
		directory_id: entry.directory_id,
		action: row.action,
		from: row.from,
		to: row.to,
		changed_fields: row.changed_fields ?? [],
		note: row.note ?? null,
		by: logActor(actor),
		at,
	});

export const createEntriesService = (deps: { now?: () => Date } = {}) => {
	const now = deps.now ?? (() => new Date());

	/** The admin's view of one location: header, expected NAP, category matching, score, entries. */
	const locationView = async (locationId: Id) => {
		const location = await locationOr404(locationId);
		const [org, client, names] = await Promise.all([
			Organization.findById(location.organization_id).select({ name: 1, type: 1 }).lean<{ _id: Types.ObjectId; name: string; type: string }>(),
			location.client_id ? Client.findById(location.client_id).select({ company_name: 1 }).lean<{ _id: Types.ObjectId; company_name: string }>() : null,
			locationBusinessCategories(location),
		]);
		const groups = await categoryGroupsFor(names);
		const { entries, directories, health } = await loadHealthEntries(location._id);
		const removed = await LocationCitation.find({ location_id: location._id, active: false }).lean<ILocationCitation[]>();
		const removedDirs = removed.length ? await Directory.find({ _id: { $in: removed.map((e) => e.directory_id) } }).lean<IDirectory[]>() : [];
		const removedMap = new Map(removedDirs.map((d) => [String(d._id), d]));
		const byName = (a: EntryView, b: EntryView) => a.directory.name.localeCompare(b.directory.name);
		return {
			location: {
				id: String(location._id),
				name: location.name,
				city: blank(location.city),
				state: blank(location.state),
				country: location.country,
				organization: org ? { id: String(org._id), name: org.name, type: org.type } : null,
				client: client ? { id: String(client._id), name: client.company_name } : null,
				nap: expectedNap(location),
			},
			business_categories: names,
			category_groups: groups,
			category_matched: groups.length > 0,
			health: healthView(health),
			entries: entries.map((e) => entryView(e, directories.get(String(e.directory_id)))).sort(byName),
			removed_from_list: removed.map((e) => entryView(e, removedMap.get(String(e.directory_id)))).sort(byName),
		};
	};

	/** Adds directories by hand (any active directory). A directory taken off the list earlier is restored. */
	const addEntries = async (locationId: Id, directoryIds: string[], actor: AdminActor) => {
		const location = await locationOr404(locationId);
		const unique = [...new Set(directoryIds)];
		const dirs = await Directory.find({ _id: { $in: unique.map(oid) } }).lean<IDirectory[]>();
		const found = new Map(dirs.map((d) => [String(d._id), d]));
		const unknown = unique.filter((id) => !found.has(id));
		const inactive = unique.filter((id) => found.get(id) && !found.get(id)?.is_active);
		if (unknown.length || inactive.length) {
			throw apiErrorWithData(httpStatus.BAD_REQUEST, 'Unknown or inactive directory.', { reason: 'invalid_directory', unknown, inactive });
		}
		const at = now();
		const result = { added: [] as string[], restored: [] as string[], already_listed: [] as string[] };
		for (const id of unique) {
			const existing = await LocationCitation.findOne({ location_id: location._id, directory_id: oid(id) }).lean<ILocationCitation>();
			if (existing?.active) {
				result.already_listed.push(id);
				continue;
			}
			if (existing) {
				await LocationCitation.updateOne({ _id: existing._id }, { $set: { active: true } });
				await writeLog(existing, { action: 'restored', from: existing.status, to: existing.status }, actor, at);
				result.restored.push(id);
				continue;
			}
			const res = await LocationCitation.updateOne(
				{ location_id: location._id, directory_id: oid(id) },
				{ $setOnInsert: { organization_id: location.organization_id, status: 'not_checked', source: 'manual', added_by: actor.id ? oid(actor.id) : null, active: true } },
				{ upsert: true },
			);
			if (!res.upsertedId) {
				result.already_listed.push(id);
				continue;
			}
			await writeLog({ _id: res.upsertedId, location_id: location._id, organization_id: location.organization_id as Types.ObjectId, directory_id: oid(id) }, { action: 'added', from: null, to: 'not_checked', note: 'Added by hand' }, actor, at);
			result.added.push(id);
		}
		const health = await updateCitationSummary(location._id);
		return { ...result, health: healthView(health) };
	};

	const updateEntry = async (entryId: Id, input: EntryUpdateInput, actor: AdminActor) => {
		const entry = await entryOr404(entryId);
		if (!entry.active) throw apiErrorWithData(httpStatus.CONFLICT, 'The directory is off this location’s list; restore it first.', { reason: 'entry_removed' });
		const location = await locationOr404(entry.location_id);
		const set: Record<string, unknown> = {};
		const changed: string[] = [];
		const cleanUrl = input.listing_url === undefined ? undefined : blank(input.listing_url);
		if (cleanUrl !== undefined && cleanUrl !== (entry.listing_url ?? null)) {
			set.listing_url = cleanUrl;
			changed.push('listing_url');
		}
		if (input.notes !== undefined && blank(input.notes) !== (entry.notes ?? null)) {
			set.notes = blank(input.notes);
			changed.push('notes');
		}
		const napNow = { name: entry.nap_found?.name ?? null, address: entry.nap_found?.address ?? null, phone: entry.nap_found?.phone ?? null, website: entry.nap_found?.website ?? null };
		let nap = napNow;
		if (input.nap_found !== undefined) {
			nap = { ...napNow };
			for (const k of ['name', 'address', 'phone', 'website'] as const) if (input.nap_found[k] !== undefined) nap[k] = blank(input.nap_found[k]);
			if (JSON.stringify(nap) !== JSON.stringify(napNow)) {
				set.nap_found = nap;
				changed.push('nap_found');
			}
		}
		const mismatch = napMismatches(expectedNap(location), nap);
		if (JSON.stringify(mismatch) !== JSON.stringify(entry.mismatch_fields ?? [])) set.mismatch_fields = mismatch;
		const nextStatus = input.status ?? entry.status;
		if (nextStatus === 'live_correct' && mismatch.length && !input.confirm && (input.status !== undefined || changed.includes('nap_found'))) {
			throw apiErrorWithData(httpStatus.CONFLICT, 'The NAP found differs from the location; send confirm: true to mark it correct anyway, or use nap_wrong.', { reason: 'nap_mismatch', mismatch_fields: mismatch });
		}
		if (input.status !== undefined && input.status !== entry.status) {
			set.status = input.status;
			changed.unshift('status');
		}
		const checkedNow = changed.some((f) => f !== 'notes') || input.checked === true;
		if (!changed.length && !input.checked) return { entry: entryView(entry, (await Directory.findById(entry.directory_id).lean<IDirectory>()) ?? undefined), changed: [] as string[] };
		const at = now();
		if (checkedNow) {
			set.last_checked_at = at;
			set.checked_by = actor.id ? oid(actor.id) : null;
		}
		await LocationCitation.updateOne({ _id: entry._id }, { $set: set });
		const action: CitationLogAction = changed.includes('status') ? 'status_changed' : changed.length ? 'updated' : 'checked';
		await writeLog(entry, { action, from: entry.status, to: nextStatus, changed_fields: changed, note: blank(input.note) }, actor, at);
		await updateCitationSummary(entry.location_id);
		const fresh = (await LocationCitation.findById(entry._id).lean<ILocationCitation>()) as ILocationCitation;
		return { entry: entryView(fresh, (await Directory.findById(entry.directory_id).lean<IDirectory>()) ?? undefined), changed };
	};

	/** One status for many entries (e.g. "submitted"). An entry whose NAP differs is not marked live_correct. */
	const bulkUpdate = async (entryIds: string[], status: CitationStatus, note: string | null | undefined, actor: AdminActor) => {
		const entries = await LocationCitation.find({ _id: { $in: [...new Set(entryIds)].map(oid) } }).lean<ILocationCitation[]>();
		const live = new Set((await Location.find({ _id: { $in: entries.map((e) => e.location_id) } }).select({ _id: 1 }).lean<{ _id: Types.ObjectId }[]>()).map((l) => String(l._id)));
		const at = now();
		const result = { updated: [] as string[], unchanged: [] as string[], skipped: [] as { entry_id: string; reason: string }[] };
		const byId = new Map(entries.map((e) => [String(e._id), e]));
		const touched = new Set<string>();
		// Results follow the request order.
		for (const id of [...new Set(entryIds)]) {
			const e = byId.get(id);
			if (!e || !live.has(String(e.location_id))) result.skipped.push({ entry_id: id, reason: 'not_found' });
			else if (!e.active) result.skipped.push({ entry_id: id, reason: 'entry_removed' });
			else if (status === 'live_correct' && (e.mismatch_fields ?? []).length) result.skipped.push({ entry_id: id, reason: 'nap_mismatch' });
			else if (e.status === status) result.unchanged.push(id);
			else {
				await LocationCitation.updateOne({ _id: e._id }, { $set: { status, last_checked_at: at, checked_by: actor.id ? oid(actor.id) : null } });
				await writeLog(e, { action: 'status_changed', from: e.status, to: status, changed_fields: ['status'], note: blank(note) }, actor, at);
				result.updated.push(id);
				touched.add(String(e.location_id));
			}
		}
		for (const locationId of touched) await updateCitationSummary(locationId);
		return result;
	};

	const setActive = async (entryId: Id, active: boolean, note: string | null | undefined, actor: AdminActor) => {
		const entry = await entryOr404(entryId);
		if (entry.active === active) return { entry: entryView(entry, (await Directory.findById(entry.directory_id).lean<IDirectory>()) ?? undefined), changed: false };
		await LocationCitation.updateOne({ _id: entry._id }, { $set: { active } });
		await writeLog(entry, { action: active ? 'restored' : 'removed_from_list', from: entry.status, to: entry.status, note: blank(note) }, actor, now());
		await updateCitationSummary(entry.location_id);
		const fresh = (await LocationCitation.findById(entry._id).lean<ILocationCitation>()) as ILocationCitation;
		return { entry: entryView(fresh, (await Directory.findById(entry.directory_id).lean<IDirectory>()) ?? undefined), changed: true };
	};

	/** Admin history of one entry, newest first (with admin names). */
	const history = async (entryId: Id, query: { page?: number; limit?: number }) => {
		const entry = await entryOr404(entryId);
		const { page, limit } = paging(query, 50);
		const [rows, total] = await Promise.all([
			CitationStatusLog.find({ location_citation_id: entry._id }).sort({ at: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean<ICitationStatusLog[]>(),
			CitationStatusLog.countDocuments({ location_citation_id: entry._id }),
		]);
		return { history: rows.map(adminLogView), page, limit, total };
	};

	return { locationView, addEntries, updateEntry, bulkUpdate, removeEntry: (id: Id, note: string | null | undefined, actor: AdminActor) => setActive(id, false, note, actor), restoreEntry: (id: Id, note: string | null | undefined, actor: AdminActor) => setActive(id, true, note, actor), history };
};

export const adminLogView = (r: ICitationStatusLog) => ({
	id: String(r._id),
	entry_id: String(r.location_citation_id),
	location_id: String(r.location_id),
	directory_id: String(r.directory_id),
	action: r.action,
	from: r.from,
	to: r.to,
	changed_fields: r.changed_fields,
	note: r.note,
	by: { admin_id: r.by?.admin_id ? String(r.by.admin_id) : null, name: r.by?.name ?? null },
	at: r.at,
});

export const entriesService = createEntriesService();
