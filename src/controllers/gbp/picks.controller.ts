import { picksService } from '../../services/gbp/picks.service';
import { OrgContext } from '../../services/org/context';
import { catchAsync, responseWrapper } from '../../utils';

// Google connect, pick, then bind (2026-10-01). loadOrgContext has set res.locals.org.

const orgOf = (res: { locals: Record<string, unknown> }): OrgContext => res.locals.org as OrgContext;

export const connections = catchAsync(async (req, res) => responseWrapper(res, await picksService.connections(orgOf(res))));
export const accountLocations = catchAsync(async (req, res) => responseWrapper(res, await picksService.accountLocations(orgOf(res), req.params.googleSub)));
export const savePicks = catchAsync(async (req, res) =>
	responseWrapper(res, await picksService.savePicks(orgOf(res), req.params.googleSub, res.locals.gbpLocationIds as string[]), 'Selection saved.'),
);
export const bind = catchAsync(async (req, res) => {
	const result = await picksService.bind(orgOf(res), req.params.pickId, res.locals.bindInput ?? {});
	return responseWrapper(res, result, result.created ? 'Location created and bound to its Business Profile.' : 'Location bound to its Business Profile.');
});
export const removePick = catchAsync(async (req, res) => responseWrapper(res, await picksService.removePick(orgOf(res), req.params.pickId), 'Removed.'));
