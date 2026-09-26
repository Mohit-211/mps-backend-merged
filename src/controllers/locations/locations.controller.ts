import httpStatus from 'http-status';
import { ILocation } from '../../models';
import { addLocationFromPlace } from '../../services/locations/add.service';
import { ListQuery, listLocations, locationHeader, locationOverview, updateLocation } from '../../services/locations/locations.service';
import { removeLocation } from '../../services/locations/remove.service';
import { OrgContext, resolveOrgContext } from '../../services/org/context';
import { catchAsync, responseWrapper } from '../../utils';

// Locations (Phase 8). List and add act in the current organization (res.locals.org); the per-location
// routes ran loadOwnedLocation (membership of the location's organization; writes need owner/member).

interface Locals { locals: Record<string, unknown> }
const orgOf = (res: Locals): OrgContext => res.locals.org as OrgContext;
const locationOf = (res: Locals): ILocation => res.locals.location as ILocation;
/** The context of the location's own organization (it may differ from the X-Organization-Id one). */
const locationContext = (res: Locals): Promise<OrgContext> => resolveOrgContext(res.locals.userId as string, String(locationOf(res).organization_id));

export const list = catchAsync(async (req, res) => responseWrapper(res, await listLocations(orgOf(res), res.locals.listQuery as ListQuery)));

export const add = catchAsync(async (req, res) => {
	const result = await addLocationFromPlace(orgOf(res), res.locals.addLocation);
	return responseWrapper(res, result, 'Location added. Next: keywords.', httpStatus.CREATED);
});

export const get = catchAsync(async (req, res) => responseWrapper(res, await locationHeader(locationOf(res))));

export const overview = catchAsync(async (req, res) => responseWrapper(res, await locationOverview(locationOf(res))));

export const update = catchAsync(async (req, res) =>
	responseWrapper(res, await updateLocation(await locationContext(res), locationOf(res), res.locals.locationUpdate), 'Location updated.'),
);

export const remove = catchAsync(async (req, res) =>
	responseWrapper(res, await removeLocation(await locationContext(res), locationOf(res)), 'Location deleted. Its history is kept.'),
);
