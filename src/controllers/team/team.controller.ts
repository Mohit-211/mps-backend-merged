import httpStatus from 'http-status';
import { OrgContext } from '../../services/org/context';
import { invitationService } from '../../services/team/invitation.service';
import { changeRole, removeMember } from '../../services/team/members.service';
import { catchAsync, responseWrapper } from '../../utils';

// Team (Phase 11). Organization routes ran loadOrgContext + requireOwner; the /auth ones are public.

interface Locals {
	locals: Record<string, unknown>;
}
const orgOf = (res: Locals): OrgContext => res.locals.org as OrgContext;
const input = <T>(res: Locals): T => res.locals.teamInput as T;

export const invite = catchAsync(async (req, res) =>
	responseWrapper(res, await invitationService.invite(orgOf(res), input(res)), 'Invitation created.', httpStatus.CREATED),
);
export const listInvitations = catchAsync(async (req, res) =>
	responseWrapper(res, await invitationService.list(orgOf(res), input<{ status?: string }>(res).status)),
);
export const revokeInvitation = catchAsync(async (req, res) =>
	responseWrapper(res, await invitationService.revoke(orgOf(res), req.params.invitationId), 'Invitation revoked.'),
);
export const changeMemberRole = catchAsync(async (req, res) =>
	responseWrapper(res, await changeRole(orgOf(res), req.params.userId, input(res)), 'Role changed.'),
);
export const removeTeamMember = catchAsync(async (req, res) => responseWrapper(res, await removeMember(orgOf(res), req.params.userId), 'Member removed.'));

export const inspectInvitation = catchAsync(async (req, res) =>
	responseWrapper(res, await invitationService.inspect(input<{ token: string }>(res).token, req.ip ?? 'unknown')),
);
export const acceptInvitation = catchAsync(async (req, res) =>
	responseWrapper(res, await invitationService.accept(input(res), req.ip ?? 'unknown'), 'Invitation accepted.'),
);
