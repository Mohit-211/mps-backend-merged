import httpStatus from 'http-status';
import { Types } from 'mongoose';
import { ILocation, ILocationKeywordGroup, Location } from '../../models/location.model';
import { TrackerSummaryDoc } from '../../models/rankRun.model';
import { normaliseKeyword, overallAvgRank, round1, round2 } from '../../ranking';
import { apiErrorWithData } from '../../utils';
import { withDefaults } from './trackingSettings';

// Keyword groups (Phase 17): named sets of a location's tracked keywords ("Emergency", "Water heaters"), for
// filtering the Rank Tracker and grid pages and for group summaries. A keyword can be in many groups or none.
// Groups don't change keywords_version; removing a keyword from tracking removes it from its groups.

export const MAX_KEYWORD_GROUPS = 20;
export const MAX_GROUP_NAME_LENGTH = 60;

export interface KeywordGroupView {
	group_id: string;
	name: string;
	/** The tracked spellings of the group's keywords. */
	keywords: string[];
}

export interface GroupTargetSummary {
	avgRank: number | null;
	foundRate: number | null;
	top3Rate: number | null;
	/** Mean of the keywords' numeric changes (positive = improved); null when none. */
	change: number | null;
	comparable_keywords: number;
}

const groupNotFound = () => apiErrorWithData(httpStatus.NOT_FOUND, 'Keyword group not found', { reason: 'group_not_found' });

const mean = (values: (number | null | undefined)[], round: (n: number) => number): number | null => {
	const nums = values.filter((v): v is number => typeof v === 'number');
	return nums.length ? round(nums.reduce((a, b) => a + b, 0) / nums.length) : null;
};

/** The group's keywords with the tracked spelling (keywords no longer tracked are left out). */
export const viewGroup = (group: ILocationKeywordGroup, tracked: { text: string; normalized: string }[]): KeywordGroupView => ({
	group_id: String(group._id),
	name: group.name,
	keywords: group.keywords.map((n) => tracked.find((k) => k.normalized === n)?.text).filter((t): t is string => Boolean(t)),
});

/**
 * Pure: a group's summary per target from one run's tracker sections: the means of its keywords' avgRank,
 * foundRate and top3Rate, and of their numeric changes. Only keywords the run measured count.
 */
export const summariseGroup = (
	tracker: { keyword: string; summary: Record<string, TrackerSummaryDoc> }[],
	normalizedKeywords: string[],
	keys: string[],
): { keywords_in_run: number; summary: Record<string, GroupTargetSummary> } => {
	const wanted = new Set(normalizedKeywords);
	const sections = tracker.filter((t) => wanted.has(normaliseKeyword(t.keyword)));
	const summary: Record<string, GroupTargetSummary> = {};
	for (const key of keys) {
		const rows = sections.map((s) => s.summary?.[key]).filter((r): r is TrackerSummaryDoc => Boolean(r));
		const changes = rows.map((r) => r.change).filter((c): c is number => typeof c === 'number');
		summary[key] = {
			avgRank: overallAvgRank(rows.map((r) => r.avgRank)),
			foundRate: mean(rows.map((r) => r.foundRate), round2),
			top3Rate: mean(rows.map((r) => r.top3Rate), round2),
			change: mean(changes, round1),
			comparable_keywords: changes.length,
		};
	}
	return { keywords_in_run: sections.length, summary };
};

/** The group a ?group= asks for (404 group_not_found), or null without one. */
export const findGroup = (groups: ILocationKeywordGroup[], groupId?: string): ILocationKeywordGroup | null => {
	if (!groupId) return null;
	const group = groups.find((g) => String(g._id) === groupId);
	if (!group) throw groupNotFound();
	return group;
};

const cleanName = (raw: string): string => String(raw).trim().replace(/\s+/g, ' ');

/** Normalised, de-duplicated keywords that must all be tracked (400 unknown_keyword lists the others). */
const resolveKeywords = (texts: string[], tracked: { normalized: string }[]): string[] => {
	const trackedSet = new Set(tracked.map((k) => k.normalized));
	const normalized = [...new Set(texts.map((t) => normaliseKeyword(String(t))))];
	const unknown = normalized.filter((n) => !trackedSet.has(n));
	if (unknown.length) {
		throw apiErrorWithData(httpStatus.BAD_REQUEST, 'Some keywords are not tracked for this location.', { reason: 'unknown_keyword', keywords: unknown });
	}
	return normalized;
};

const assertNameFree = (groups: ILocationKeywordGroup[], name: string, exceptId?: string) => {
	const taken = groups.some((g) => g.name.toLowerCase() === name.toLowerCase() && String(g._id) !== exceptId);
	if (taken) throw apiErrorWithData(httpStatus.CONFLICT, 'A keyword group with this name already exists.', { reason: 'group_name_taken' });
};

const listView = (location: Pick<ILocation, 'tracking'>) => {
	const tracking = withDefaults(location.tracking);
	return { groups: tracking.keyword_groups.map((g) => viewGroup(g, tracking.keywords)), limit: MAX_KEYWORD_GROUPS };
};

export const listGroups = (location: ILocation) => listView(location);

export const createGroup = async (location: ILocation, input: { name: string; keywords: string[] }) => {
	const tracking = withDefaults(location.tracking);
	if (tracking.keyword_groups.length >= MAX_KEYWORD_GROUPS) {
		throw apiErrorWithData(httpStatus.BAD_REQUEST, `At most ${MAX_KEYWORD_GROUPS} keyword groups per location.`, { reason: 'too_many_groups', limit: MAX_KEYWORD_GROUPS });
	}
	const name = cleanName(input.name);
	assertNameFree(tracking.keyword_groups, name);
	const group: ILocationKeywordGroup = { _id: new Types.ObjectId(), name, keywords: resolveKeywords(input.keywords, tracking.keywords) };
	await Location.updateOne({ _id: location._id }, { $push: { 'tracking.keyword_groups': group } });
	return viewGroup(group, tracking.keywords);
};

export const updateGroup = async (location: ILocation, groupId: string, input: { name?: string; keywords?: string[] }) => {
	const tracking = withDefaults(location.tracking);
	const group = findGroup(tracking.keyword_groups, groupId) as ILocationKeywordGroup;
	const next: ILocationKeywordGroup = { ...group };
	if (input.name !== undefined) {
		next.name = cleanName(input.name);
		assertNameFree(tracking.keyword_groups, next.name, groupId);
	}
	if (input.keywords !== undefined) next.keywords = resolveKeywords(input.keywords, tracking.keywords);
	await Location.updateOne(
		{ _id: location._id, 'tracking.keyword_groups._id': group._id },
		{ $set: { 'tracking.keyword_groups.$.name': next.name, 'tracking.keyword_groups.$.keywords': next.keywords } },
	);
	return viewGroup(next, tracking.keywords);
};

export const deleteGroup = async (location: ILocation, groupId: string) => {
	const group = findGroup(withDefaults(location.tracking).keyword_groups, groupId) as ILocationKeywordGroup;
	await Location.updateOne({ _id: location._id }, { $pull: { 'tracking.keyword_groups': { _id: group._id } } });
	return { deleted: true, group_id: groupId };
};
