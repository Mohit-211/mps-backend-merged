import httpStatus from 'http-status';
import * as clientService from '../../services/clients/client.service';
import { OrgContext } from '../../services/org/context';
import { catchAsync, responseWrapper } from '../../utils';

// Agency clients (Phase 8). loadOrgContext + requireAgency ran; writes also ran requireWrite.

interface Locals { locals: Record<string, unknown> }
const orgOf = (res: Locals): OrgContext => res.locals.org as OrgContext;

export const list = catchAsync(async (req, res) => responseWrapper(res, await clientService.listClients(orgOf(res), res.locals.clientQuery)));
export const create = catchAsync(async (req, res) =>
	responseWrapper(res, await clientService.createClient(orgOf(res), res.locals.clientInput), 'Client created.', httpStatus.CREATED),
);
export const get = catchAsync(async (req, res) => responseWrapper(res, await clientService.getClientDetail(orgOf(res), req.params.clientId)));
export const update = catchAsync(async (req, res) =>
	responseWrapper(res, await clientService.updateClient(orgOf(res), req.params.clientId, res.locals.clientInput), 'Client updated.'),
);
export const remove = catchAsync(async (req, res) => responseWrapper(res, await clientService.deleteClient(orgOf(res), req.params.clientId), 'Client deleted.'));
export const assign = catchAsync(async (req, res) =>
	responseWrapper(res, await clientService.assignLocation(orgOf(res), req.params.clientId, res.locals.assignLocationId as string), 'Location assigned.'),
);
export const unassign = catchAsync(async (req, res) =>
	responseWrapper(res, await clientService.unassignLocation(orgOf(res), req.params.clientId, req.params.locationId), 'Location unassigned.'),
);
