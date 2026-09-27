import { Types } from 'mongoose';
import { Location } from '../../models/location.model';
import { withUsage } from './scope';

// Jobs attribute their Google calls to the location's organization (Phase 12.5).
export const withLocationUsage = async <T>(locationId: Types.ObjectId | string | null | undefined, fn: () => Promise<T>): Promise<T> => {
	const location = locationId ? await Location.findById(locationId).select({ organization_id: 1 }).lean<{ organization_id?: Types.ObjectId | null }>() : null;
	return withUsage({ organization_id: location?.organization_id ?? null, location_id: locationId ?? null }, fn);
};
