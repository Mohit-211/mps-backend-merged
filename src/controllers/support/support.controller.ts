import httpStatus from 'http-status';
import { Response } from 'express';
import { OrgContext } from '../../services/org/context';
import * as tickets from '../../services/support/tickets.service';
import { catchAsync, responseWrapper } from '../../utils';

// Support tickets for organization users (Phase 13b). loadOrgContext ran; input on res.locals.input.

const ctx = (res: Response): OrgContext => res.locals.org as OrgContext;
const p = (req: { params: Record<string, string> }) => String(req.params.ticketId);

export const create = catchAsync(async (req, res) => responseWrapper(res, await tickets.createTicket(ctx(res), res.locals.input), 'Ticket created.', httpStatus.CREATED));
export const list = catchAsync(async (req, res) => responseWrapper(res, await tickets.listTickets(ctx(res), res.locals.input)));
export const get = catchAsync(async (req, res) => responseWrapper(res, await tickets.getTicket(ctx(res), p(req))));
export const reply = catchAsync(async (req, res) => responseWrapper(res, await tickets.customerReply(ctx(res), p(req), res.locals.input.message), 'Reply sent.'));
export const close = catchAsync(async (req, res) => responseWrapper(res, await tickets.customerClose(ctx(res), p(req)), 'Ticket closed.'));
