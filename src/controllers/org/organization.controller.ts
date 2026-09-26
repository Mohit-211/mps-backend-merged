import { usageFor } from '../../services/org/limits';
import { OrgContext } from '../../services/org/context';
import { listMembers, organizationView, updateOrganization } from '../../services/org/organization.service';
import { catchAsync, responseWrapper } from '../../utils';

// Organization (Phase 8). loadOrgContext ran.

interface Locals { locals: Record<string, unknown> }
const orgOf = (res: Locals): OrgContext => res.locals.org as OrgContext;

export const get = catchAsync(async (req, res) => responseWrapper(res, await organizationView(orgOf(res))));
export const update = catchAsync(async (req, res) => responseWrapper(res, await updateOrganization(orgOf(res), res.locals.orgUpdate), 'Organization updated.'));
export const usage = catchAsync(async (req, res) => responseWrapper(res, await usageFor(orgOf(res).organization)));
export const members = catchAsync(async (req, res) => responseWrapper(res, await listMembers(orgOf(res))));
