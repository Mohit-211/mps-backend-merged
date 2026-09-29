import { Types } from 'mongoose';
import { tokenTypes } from '../../configs/constantTypes';
import { ILocation, UserAuth, UserGBP } from '../../models';
import { isSetUp } from '../org/onboardingState';

// Location status for the locations list (Phase 8, PRODUCT.md). First match wins:
//   setup_required     onboarding not completed (or, for older locations, no keywords)
//   reconnect_required bound, but the binding's Google connection was revoked (reconnect needed)
//   gbp_not_connected  no GBP binding
//   active

export const LOCATION_STATUSES = ['active', 'setup_required', 'gbp_not_connected', 'reconnect_required'] as const;
export type LocationStatus = (typeof LOCATION_STATUSES)[number];

type StatusInput = Pick<ILocation, '_id' | 'onboarding' | 'tracking'>;

export const statusOf = (location: StatusInput, binding: { revoked: boolean } | null): LocationStatus => {
	if (!isSetUp(location)) return 'setup_required';
	if (binding?.revoked) return 'reconnect_required';
	if (!binding) return 'gbp_not_connected';
	return 'active';
};

/** Statuses for many locations with two queries (bindings, then their Google connections). */
export const statusesFor = async (locations: StatusInput[]): Promise<Map<string, LocationStatus>> => {
	const ids = locations.map((l) => l._id as Types.ObjectId);
	const bindings = await UserGBP.find({ location_id: { $in: ids }, is_active: true }).select({ location_id: 1, user_id: 1, google_sub: 1 }).lean();
	const connections = bindings.length
		? await UserAuth.find({ user_id: { $in: bindings.map((b) => b.user_id) }, token_type: tokenTypes.GBP, is_active: true })
				.select({ user_id: 1, google_sub: 1, status: 1 })
				.lean()
		: [];
	const connectionState = (userId: unknown, sub: string | null | undefined): 'active' | 'revoked' | 'missing' => {
		const rows = connections.filter((c) => String(c.user_id) === String(userId));
		const row = sub ? rows.find((c) => c.google_sub === sub) : undefined;
		return row ? (row.status === 'revoked' ? 'revoked' : 'active') : 'missing';
	};
	const byLocation = new Map(bindings.map((b) => [String(b.location_id), { revoked: connectionState(b.user_id, b.google_sub) !== 'active' }]));
	return new Map(locations.map((l) => [String(l._id), statusOf(l, byLocation.get(String(l._id)) ?? null)]));
};
