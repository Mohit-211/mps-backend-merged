import { Types } from 'mongoose';
import httpStatus from 'http-status';
import config from '../../configs/config';
import { Client, ISubscriptionPlan, IUser, Location, SubscriptionPlan, User } from '../../models';
import { apiErrorWithData } from '../../utils';

// Plan limits (Phase 8). Read from the organization owner's active subscription plan
// (SubscriptionPlan.location_limit / keyword_limit, data only); otherwise DEFAULT_LOCATION_LIMIT and
// DEFAULT_KEYWORD_LIMIT. Soft-deleted locations don't count, so deleting frees a slot at once.

type Id = Types.ObjectId | string;

export interface PlanInfo {
	id: string | null;
	name: string | null;
	source: 'subscription' | 'default';
}

export interface OrgLimits {
	plan: PlanInfo;
	location_limit: number;
	/** null = no org-wide cap (the per-location cap RANK_MAX_KEYWORDS still applies). */
	keyword_limit: number | null;
}

export interface OrgUsage {
	plan: PlanInfo;
	locations: { used: number; limit: number };
	keywords: { used: number; limit: number | null };
	clients: { used: number } | null;
}

export const limitsFor = async (org: { owner_user_id: Id }): Promise<OrgLimits> => {
	const owner = await User.findById(org.owner_user_id).select({ subscription_status: 1, current_plan_id: 1 }).lean<Pick<IUser, 'subscription_status' | 'current_plan_id'>>();
	let plan: Pick<ISubscriptionPlan, '_id' | 'name' | 'location_limit' | 'keyword_limit'> | null = null;
	if (owner?.subscription_status === 'ACTIVE' && owner.current_plan_id) {
		plan = await SubscriptionPlan.findById(owner.current_plan_id).select({ name: 1, location_limit: 1, keyword_limit: 1 }).lean();
	}
	return {
		plan: plan ? { id: String(plan._id), name: plan.name, source: 'subscription' } : { id: null, name: null, source: 'default' },
		location_limit: typeof plan?.location_limit === 'number' ? plan.location_limit : config.organization.defaultLocationLimit,
		keyword_limit: typeof plan?.keyword_limit === 'number' ? plan.keyword_limit : config.organization.defaultKeywordLimit,
	};
};

export const countActiveLocations = (organizationId: Id) => Location.countDocuments({ organization_id: organizationId, is_active: true });

/** Tracked keywords across the organization's active locations (optionally leaving one location out). */
export const countKeywords = async (organizationId: Id, excludeLocationId?: Id): Promise<number> => {
	const match: Record<string, unknown> = { organization_id: new Types.ObjectId(String(organizationId)), is_active: true, deleted_at: null };
	if (excludeLocationId) match._id = { $ne: new Types.ObjectId(String(excludeLocationId)) };
	const [row] = await Location.aggregate<{ total: number }>([
		{ $match: match },
		{ $group: { _id: null, total: { $sum: { $size: { $ifNull: ['$tracking.keywords', []] } } } } },
	]);
	return row?.total ?? 0;
};

export const usageFor = async (org: { _id: Id; owner_user_id: Id; type: string }): Promise<OrgUsage> => {
	const limits = await limitsFor(org);
	const [locations, keywords, clients] = await Promise.all([
		countActiveLocations(org._id),
		countKeywords(org._id),
		org.type === 'agency' ? Client.countDocuments({ organization_id: org._id, is_active: true }) : Promise.resolve(null),
	]);
	return {
		plan: limits.plan,
		locations: { used: locations, limit: limits.location_limit },
		keywords: { used: keywords, limit: limits.keyword_limit },
		clients: clients === null ? null : { used: clients },
	};
};

/** Throws 403 location_limit_reached when the organization can't add another location. */
export const assertCanAddLocation = async (org: { _id: Id; owner_user_id: Id }): Promise<void> => {
	const [limits, used] = await Promise.all([limitsFor(org), countActiveLocations(org._id)]);
	if (used >= limits.location_limit) {
		throw apiErrorWithData(httpStatus.FORBIDDEN, `Your plan allows ${limits.location_limit} location${limits.location_limit === 1 ? '' : 's'}.`, {
			reason: 'location_limit_reached',
			used,
			limit: limits.location_limit,
			plan: limits.plan,
		});
	}
};

/** Throws 403 keyword_limit_reached when setting `count` keywords on a location would exceed the org-wide cap. */
export const assertKeywordLimit = async (org: { _id: Id; owner_user_id: Id }, locationId: Id, count: number): Promise<void> => {
	const limits = await limitsFor(org);
	if (limits.keyword_limit === null) return;
	const others = await countKeywords(org._id, locationId);
	if (others + count > limits.keyword_limit) {
		throw apiErrorWithData(httpStatus.FORBIDDEN, `Your plan allows ${limits.keyword_limit} tracked keywords in total.`, {
			reason: 'keyword_limit_reached',
			used: others,
			requested: count,
			limit: limits.keyword_limit,
			plan: limits.plan,
		});
	}
};
