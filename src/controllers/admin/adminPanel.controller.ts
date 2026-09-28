import { Response } from 'express';
import * as orgs from '../../services/admin/organizations.service';
import { adminOverview } from '../../services/admin/overview.service';
import * as users from '../../services/admin/users.service';
import { AuditActor } from '../../services/billing/audit';
import * as tickets from '../../services/support/tickets.service';
import { catchAsync, responseWrapper } from '../../utils';

// Admin panel (Phase 13b): users, organizations, support tickets, overview. validateAdminJWTToken +
// the route's permission ran; validated input is on res.locals.input.

const actor = (res: Response): AuditActor => {
	const a = res.locals.admin as { id: string; name?: string | null };
	return { id: a.id, name: a.name ?? null };
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Joi-validated input
const input = (res: Response): any => res.locals.input ?? {};
const p = (req: { params: Record<string, string> }, k: string) => String(req.params[k]);

export const overview = catchAsync(async (req, res) => responseWrapper(res, await adminOverview()));

export const listUsers = catchAsync(async (req, res) => responseWrapper(res, await users.listUsers(input(res))));
export const getUser = catchAsync(async (req, res) => responseWrapper(res, await users.getUser(p(req, 'userId'))));
export const disableUser = catchAsync(async (req, res) => responseWrapper(res, await users.disableUser(actor(res), p(req, 'userId'), input(res).reason), 'User disabled; sessions ended.'));
export const enableUser = catchAsync(async (req, res) => responseWrapper(res, await users.enableUser(actor(res), p(req, 'userId')), 'User enabled.'));
export const forceLogout = catchAsync(async (req, res) => responseWrapper(res, await users.forceLogout(actor(res), p(req, 'userId')), 'Every session ended.'));
export const resendVerification = catchAsync(async (req, res) => responseWrapper(res, await users.resendVerification(actor(res), p(req, 'userId')), 'Verification link sent.'));
export const markVerified = catchAsync(async (req, res) => responseWrapper(res, await users.markUserVerified(actor(res), p(req, 'userId')), 'Email marked verified.'));

export const listOrganizations = catchAsync(async (req, res) => responseWrapper(res, await orgs.listOrganizations(input(res))));
export const getOrganization = catchAsync(async (req, res) => responseWrapper(res, await orgs.getOrganization(p(req, 'organizationId'))));
export const suspend = catchAsync(async (req, res) => responseWrapper(res, await orgs.suspendOrganization(actor(res), p(req, 'organizationId'), input(res).reason), 'Organization suspended.'));
export const unsuspend = catchAsync(async (req, res) => responseWrapper(res, await orgs.unsuspendOrganization(actor(res), p(req, 'organizationId'), input(res).note || null), 'Organization unsuspended.'));
export const extendTrial = catchAsync(async (req, res) => responseWrapper(res, await orgs.extendTrial(actor(res), p(req, 'organizationId'), new Date(input(res).trial_ends_at)), 'Trial updated.'));
export const setLimits = catchAsync(async (req, res) => responseWrapper(res, await orgs.setLimitOverrides(actor(res), p(req, 'organizationId'), input(res)), 'Limits saved.'));

export const listTickets = catchAsync(async (req, res) => responseWrapper(res, await tickets.adminListTickets(input(res))));
export const ticketCounts = catchAsync(async (req, res) => responseWrapper(res, await tickets.adminCounts()));
export const getTicket = catchAsync(async (req, res) => responseWrapper(res, await tickets.adminGetTicket(p(req, 'ticketId'))));
export const replyTicket = catchAsync(async (req, res) => responseWrapper(res, await tickets.adminReply(actor(res), p(req, 'ticketId'), input(res)), 'Reply saved.'));
export const updateTicket = catchAsync(async (req, res) => responseWrapper(res, await tickets.adminUpdate(p(req, 'ticketId'), input(res)), 'Ticket saved.'));
