import httpStatus from 'http-status';
import { Types } from 'mongoose';
import { hasFeature } from '../../billing/entitlement';
import { Feature } from '../../billing/constants';
import { ILocation } from '../../models';
import { loadEntitlement } from '../../services/billing/entitlement.service';
import { OrgContext } from '../../services/org/context';
import { apiErrorWithData, catchAsync } from '../../utils';

// Billing gates (Phase 13a). Run after loadOrgContext (res.locals.org) or loadOwnedLocation
// (res.locals.location). requireBilling blocks what costs money or creates work when the organization
// is read-only (trial over without a subscription, grace expired, suspended): 402 subscription_required.
// requireFeature checks the plan's entitlements (all on today).

const organizationIdOf = (locals: Record<string, unknown>): Types.ObjectId | null => {
	const org = locals.org as OrgContext | undefined;
	if (org?.organization?._id) return org.organization._id as Types.ObjectId;
	const location = locals.location as ILocation | undefined;
	return (location?.organization_id as Types.ObjectId | undefined) ?? null;
};

const loadFor = async (locals: Record<string, unknown>) => {
	if (locals.entitlement) return locals.entitlement as Awaited<ReturnType<typeof loadEntitlement>>;
	const id = organizationIdOf(locals);
	if (!id) return null;
	const loaded = await loadEntitlement(String(id));
	locals.entitlement = loaded;
	return loaded;
};

export const requireBilling = catchAsync(async (req, res, next) => {
	const loaded = await loadFor(res.locals);
	if (loaded?.entitlement.read_only) {
		const e = loaded.entitlement;
		throw apiErrorWithData(
			httpStatus.PAYMENT_REQUIRED,
			e.state === 'suspended_by_admin' ? 'This organization is suspended. Contact support.' : 'An active subscription is required for this action.',
			{ reason: e.state === 'suspended_by_admin' ? 'organization_suspended' : 'subscription_required', billing: { state: e.state, trial_ends_at: e.trial_ends_at } },
		);
	}
	next();
});

export const requireFeature = (feature: Feature) =>
	catchAsync(async (req, res, next) => {
		const loaded = await loadFor(res.locals);
		if (loaded && !hasFeature(loaded.entitlement, feature)) {
			throw apiErrorWithData(httpStatus.FORBIDDEN, 'Your plan does not include this feature.', { reason: 'feature_not_included', feature });
		}
		next();
	});
