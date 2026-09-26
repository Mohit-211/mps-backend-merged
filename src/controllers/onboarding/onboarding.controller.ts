import { ILocation } from '../../models/location.model';
import { onboardingService, placesSearchService, suggestionsService } from '../../services/onboarding';
import { catchAsync, responseWrapper } from '../../utils';

// Onboarding (Phase 7a). Auth and validation ran in the route middlewares.

const userIdOf = (req: { body?: { user?: { _id?: unknown } } }): string => String(req.body?.user?._id);

export const getState = catchAsync(async (req, res) => responseWrapper(res, await onboardingService.getState(userIdOf(req))));

export const listProfiles = catchAsync(async (req, res) => responseWrapper(res, await onboardingService.listProfiles(userIdOf(req))));

export const selectProfile = catchAsync(async (req, res) => {
	const result = await onboardingService.selectProfile(userIdOf(req), res.locals.selectProfile);
	return responseWrapper(res, result, result.created ? 'Location created and linked to the Business Profile.' : 'Location linked to the Business Profile.');
});

export const complete = catchAsync(async (req, res) => {
	const result = await onboardingService.complete(userIdOf(req), res.locals.locationId as string);
	return responseWrapper(res, result, 'Onboarding complete. The first ranking run is queued.');
});

export const competitorSuggestions = catchAsync(async (req, res) => {
	const result = await suggestionsService.getSuggestions(res.locals.location as ILocation, res.locals.userId as string, {
		refresh: res.locals.refresh as boolean,
	});
	return responseWrapper(res, result);
});

export const searchPlaces = catchAsync(async (req, res) => {
	const result = await placesSearchService.search(res.locals.location as ILocation, res.locals.userId as string, res.locals.q as string);
	return responseWrapper(res, result);
});
