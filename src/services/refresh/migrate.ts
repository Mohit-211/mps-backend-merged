import { ILocation, Location } from '../../models';
import { anchorDayFrom, nextRefreshAt, zoneFor } from './cadence';

// 7b migration (idempotent): tracking.frequency weekly/monthly → auto_monthly, manual → manual_only;
// every set-up location (≥ 1 keyword) without a schedule gets refresh.anchor_day (day of setup
// completion, else creation; clamped to 28) and, when auto_monthly, its next monthly refresh.

export interface RefreshMigrationResult {
	frequencies: { auto_monthly: number; manual_only: number };
	scheduled: number;
}

export const migrateRefreshSchedule = async (now: Date = new Date()): Promise<RefreshMigrationResult> => {
	const auto = await Location.updateMany({ 'tracking.frequency': { $in: ['weekly', 'monthly'] } }, { $set: { 'tracking.frequency': 'auto_monthly' } });
	const manual = await Location.updateMany({ 'tracking.frequency': 'manual' }, { $set: { 'tracking.frequency': 'manual_only' } });

	const unscheduled = await Location.find({
		'tracking.keywords.0': { $exists: true },
		$or: [{ refresh: { $exists: false } }, { refresh: null }, { 'refresh.anchor_day': { $exists: false } }],
	}).lean<ILocation[]>();
	let scheduled = 0;
	for (const location of unscheduled) {
		const zone = zoneFor(location);
		const since = location.onboarding?.completed_at ?? location.created_at ?? now;
		const anchor = anchorDayFrom(new Date(since), zone);
		const auto_ = (location.tracking?.frequency ?? 'auto_monthly') !== 'manual_only';
		const res = await Location.updateOne(
			{ _id: location._id, 'refresh.anchor_day': { $exists: false } },
			{ $set: { 'refresh.anchor_day': anchor, 'refresh.next_refresh_at': auto_ ? nextRefreshAt(anchor, zone, now) : null } },
		);
		scheduled += res.modifiedCount;
	}
	return { frequencies: { auto_monthly: auto.modifiedCount, manual_only: manual.modifiedCount }, scheduled };
};
