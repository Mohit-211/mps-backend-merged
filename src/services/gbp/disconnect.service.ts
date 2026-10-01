import { Types } from 'mongoose';
import logger from '../../configs/logger';
import { ILocation, Location } from '../../models';
import { softDeleteLocation } from '../locations/remove.service';
import { bindingService } from './binding.service';

// Disconnecting a Google account (Mohit, 2026-10-01): "All the data and locations related to this Google
// account will be removed if disconnected." The account is revoked and unbound (binding.service), then every
// location that was bound through it is soft-deleted like DELETE /locations/:id (jobs cancelled, slot freed;
// history kept in the database but hidden). Unbinding one location keeps it (status gbp_disconnected).

type UserId = Types.ObjectId | string;

export interface DisconnectDeps {
	disconnect?: typeof bindingService.disconnect;
	remove?: (location: ILocation, actorUserId: string) => Promise<unknown>;
}

export const disconnectAccount = async (userId: UserId, googleSub: string | null | undefined, deps: DisconnectDeps = {}) => {
	const result = await (deps.disconnect ?? bindingService.disconnect)(userId, googleSub);
	const remove = deps.remove ?? ((location: ILocation, actor: string) => softDeleteLocation(location, actor));
	const locations = await Location.find({ _id: { $in: result.location_ids }, is_active: true });
	const removed: { location_id: string; name: string }[] = [];
	for (const location of locations) {
		await remove(location, String(userId));
		removed.push({ location_id: String(location._id), name: location.name });
	}
	logger.info(`gbp disconnect: user ${String(userId)} removed ${removed.length} location(s)`);
	return {
		revoked: result.revoked,
		bindings_removed: result.bindings_removed,
		picks_removed: result.picks_removed,
		google_email: result.google_email,
		locations_removed: removed,
	};
};
