import { ILocation } from '../../models/location.model';
import { GOOGLE_ATTRIBUTION } from '../../constants/attribution';
import { OrgContext } from '../../services/org/context';
import { skipStep as skipOrgStep } from '../../services/org/onboardingState';
import { centerService, onboardingService, placesSearchService, suggestionsService } from '../../services/onboarding';
import { catchAsync, responseWrapper } from '../../utils';

// Onboarding (Phase 7a). Auth and validation ran in the route middlewares.

const userIdOf = (req: { body?: { user?: { _id?: unknown } } }): string => String(req.body?.user?._id);

const orgOf = (res: { locals: Record<string, unknown> }): OrgContext => res.locals.org as OrgContext;

export const getState = catchAsync(async (req, res) => responseWrapper(res, await onboardingService.getState(orgOf(res))));

export const complete = catchAsync(async (req, res) => {
	const result = await onboardingService.complete(userIdOf(req), res.locals.locationId as string);
	return responseWrapper(res, result, 'Onboarding complete. The first ranking run is queued.');
});

export const skipStep = catchAsync(async (req, res) => {
	const ctx = orgOf(res);
	await skipOrgStep(ctx.organization._id, res.locals.skipStep as 'google' | 'reporting_brand');
	return responseWrapper(res, await onboardingService.getState(ctx), 'Step skipped.');
});

export const competitorSuggestions = catchAsync(async (req, res) => {
	const result = await suggestionsService.getSuggestions(res.locals.location as ILocation, res.locals.userId as string, {
		refresh: res.locals.refresh as boolean,
	});
	return responseWrapper(res, { ...result, attribution: GOOGLE_ATTRIBUTION });
});

export const searchPlaces = catchAsync(async (req, res) => {
	const location = res.locals.location as ILocation | null;
	if (location) {
		return responseWrapper(res, { ...(await placesSearchService.search(location, res.locals.userId as string, res.locals.q as string)), attribution: GOOGLE_ATTRIBUTION });
	}
	const ctx = orgOf(res);
	const country = (res.locals.country as string | null) ?? ctx.organization.country;
	return responseWrapper(res, {
		...(await placesSearchService.searchForNewLocation(ctx.organization._id, country, res.locals.userId as string, res.locals.q as string)),
		attribution: GOOGLE_ATTRIBUTION,
	});
});

export const setCenter = catchAsync(async (req, res) => {
	const location = res.locals.location as ILocation;
	const userId = res.locals.userId as string;
	const picked = res.locals.centerPlace as { place_id: string; session?: string } | null;
	const result = picked
		? await centerService.setCenterFromPlace(location, userId, picked.place_id, picked.session)
		: await centerService.setCenter(location, userId, res.locals.centerQuery as string);
	return responseWrapper(res, result, 'Business center saved.');
});

// 2026-10-01: the setup-center picker (cities, regions, postal codes).
export const autocompletePlaces = catchAsync(async (req, res) => {
	const q = res.locals.autocomplete as { q: string; session: string; country: string | null };
	const country = q.country ?? orgOf(res).organization.country;
	const result = await centerService.autocomplete(res.locals.userId as string, q.q, country, q.session);
	return responseWrapper(res, { ...result, attribution: GOOGLE_ATTRIBUTION });
});

