import httpStatus from 'http-status';
import { Types } from 'mongoose';
import config from '../../configs/config';
import logger from '../../configs/logger';
import {
	Admin,
	Counter,
	ISupportMessage,
	ISupportTicket,
	Location,
	Organization,
	Profile,
	SupportMessage,
	SupportTicket,
	TicketCategory,
	TicketPriority,
	TicketStatus,
	User,
} from '../../models';
import { apiErrorWithData } from '../../utils';
import { sendSupportEmail } from '../common/email.service';
import { OrgContext } from '../org/context';

// Support tickets (Phase 13b): customers open tickets in their organization and reply in a thread; the
// team answers from the admin panel. A client_user sees only its own tickets. Internal notes are never
// shown to customers. New tickets and replies are emailed (development / test: logged, masked).

type Id = Types.ObjectId | string;
const notFound = () => apiErrorWithData(httpStatus.NOT_FOUND, 'Ticket not found.', { reason: 'not_found' });
const oid = (id: string) => (Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null);

const nextNumber = async (): Promise<string> => {
	const row = await Counter.findOneAndUpdate({ key: 'support_ticket' }, { $inc: { value: 1 } }, { upsert: true, new: true }).lean<{ value: number }>();
	return `TCK-${String(row?.value ?? 1).padStart(6, '0')}`;
};

const ticketView = (t: ISupportTicket) => ({
	id: String(t._id),
	number: t.number,
	subject: t.subject,
	category: t.category,
	status: t.status,
	priority: t.priority,
	location_id: t.location_id ? String(t.location_id) : null,
	messages: t.messages,
	last_message_at: t.last_message_at,
	last_message_by: t.last_message_by,
	created_at: t.created_at,
	closed_at: t.closed_at,
});

const messageView = (m: ISupportMessage, forTeam: boolean) => ({
	id: String(m._id),
	// Customers see "MyPageSEO team" for staff replies, never the admin's name.
	author: m.author.kind === 'admin' && !forTeam ? { kind: 'team', name: 'MyPageSEO team' } : { kind: m.author.kind, name: m.author.name, ...(forTeam ? { id: String(m.author.id) } : {}) },
	body: m.body,
	...(forTeam ? { internal: m.internal } : {}),
	created_at: m.created_at,
});

// ---- emails ----

const email = async (to: string | null, subject: string, lines: string[]): Promise<void> => {
	if (!to) return;
	// 13b: sent or logged by the email service (EMAIL_TRANSPORT).
	try {
		await sendSupportEmail({ to, subject, text: lines.join('\n\n') });
	} catch (err) {
		logger.warn(`support email failed: ${(err as Error).message}`);
	}
};
const appLink = (t: ISupportTicket) => `${(config.auth.frontendUrl || '').replace(/\/$/, '')}/support/${String(t._id)}`;
const customerEmailOf = async (t: ISupportTicket) => (await User.findById(t.created_by).select({ email: 1 }).lean<{ email?: string }>())?.email ?? null;

// ---- customer side ----

const visibleFilter = (ctx: OrgContext): Record<string, unknown> => ({
	organization_id: ctx.organization._id,
	...(ctx.membership.role === 'client_user' ? { created_by: new Types.ObjectId(ctx.userId) } : {}),
});

const loadForCustomer = async (ctx: OrgContext, ticketId: string): Promise<ISupportTicket> => {
	const id = oid(ticketId);
	const t = id ? await SupportTicket.findOne({ _id: id, ...visibleFilter(ctx) }).lean<ISupportTicket>() : null;
	if (!t) throw notFound();
	return t;
};

export const createTicket = async (ctx: OrgContext, input: { subject: string; category?: TicketCategory; message: string; location_id?: string | null }, now: Date = new Date()) => {
	let locationId: Types.ObjectId | null = null;
	if (input.location_id) {
		const loc = await Location.findOne({ _id: oid(input.location_id), organization_id: ctx.organization._id, is_active: true }).select({ _id: 1 }).lean();
		if (!loc) throw apiErrorWithData(httpStatus.BAD_REQUEST, 'Unknown location.', { reason: 'unknown_location' });
		locationId = loc._id as Types.ObjectId;
	}
	const name = (await Profile.findOne({ user_id: ctx.userId }).select({ name: 1 }).lean<{ name?: string }>())?.name ?? null;
	const ticket = (
		await SupportTicket.create({
			number: await nextNumber(),
			organization_id: ctx.organization._id,
			created_by: ctx.userId,
			location_id: locationId,
			subject: input.subject,
			category: input.category ?? 'other',
			last_message_at: now,
			last_message_by: 'customer',
			messages: 1,
		})
	).toObject() as ISupportTicket;
	await SupportMessage.create({ ticket_id: ticket._id, author: { kind: 'user', id: ctx.userId, name }, body: input.message, internal: false });
	await email(config.email.supportInbox, `New support ticket ${ticket.number}: ${ticket.subject}`, [`${ctx.organization.name} opened ticket ${ticket.number} (${ticket.category}).`, input.message]);
	return { ...ticketView(ticket), thread: await thread(ticket, false) };
};

const thread = async (t: ISupportTicket, forTeam: boolean) =>
	(await SupportMessage.find({ ticket_id: t._id, ...(forTeam ? {} : { internal: false }) }).sort({ created_at: 1, _id: 1 }).lean<ISupportMessage[]>()).map((m) => messageView(m, forTeam));

export const listTickets = async (ctx: OrgContext, f: { status?: TicketStatus; page: number; limit: number }) => {
	const q: Record<string, unknown> = { ...visibleFilter(ctx), ...(f.status ? { status: f.status } : {}) };
	const [rows, total] = await Promise.all([SupportTicket.find(q).sort({ last_message_at: -1 }).skip((f.page - 1) * f.limit).limit(f.limit).lean<ISupportTicket[]>(), SupportTicket.countDocuments(q)]);
	return { tickets: rows.map(ticketView), page: f.page, limit: f.limit, total };
};

export const getTicket = async (ctx: OrgContext, ticketId: string) => {
	const t = await loadForCustomer(ctx, ticketId);
	return { ...ticketView(t), thread: await thread(t, false) };
};

export const customerReply = async (ctx: OrgContext, ticketId: string, body: string, now: Date = new Date()) => {
	const t = await loadForCustomer(ctx, ticketId);
	if (t.status === 'closed') throw apiErrorWithData(httpStatus.CONFLICT, 'This ticket is closed. Open a new one.', { reason: 'ticket_closed' });
	const name = (await Profile.findOne({ user_id: ctx.userId }).select({ name: 1 }).lean<{ name?: string }>())?.name ?? null;
	await SupportMessage.create({ ticket_id: t._id, author: { kind: 'user', id: ctx.userId, name }, body, internal: false });
	// A customer reply puts the ticket back with the team (also reopening a resolved one).
	const updated = (await SupportTicket.findByIdAndUpdate(t._id, { $set: { status: 'open', last_message_at: now, last_message_by: 'customer' }, $inc: { messages: 1 } }, { new: true }).lean<ISupportTicket>()) as ISupportTicket;
	await email(config.email.supportInbox, `Reply on ${t.number}: ${t.subject}`, [`${ctx.organization.name} replied on ticket ${t.number}.`, body]);
	return { ...ticketView(updated), thread: await thread(updated, false) };
};

export const customerClose = async (ctx: OrgContext, ticketId: string, now: Date = new Date()) => {
	const t = await loadForCustomer(ctx, ticketId);
	const updated = (await SupportTicket.findByIdAndUpdate(t._id, { $set: { status: 'closed', closed_at: now } }, { new: true }).lean<ISupportTicket>()) as ISupportTicket;
	return ticketView(updated);
};

// ---- team side ----

export interface TeamActor {
	id: string;
	name: string | null;
}

const loadForTeam = async (ticketId: string): Promise<ISupportTicket> => {
	const id = oid(ticketId);
	const t = id ? await SupportTicket.findById(id).lean<ISupportTicket>() : null;
	if (!t) throw notFound();
	return t;
};

const teamView = async (t: ISupportTicket) => {
	const [org, customer, assignee] = await Promise.all([
		Organization.findById(t.organization_id).select({ name: 1, type: 1 }).lean<{ name: string; type: string }>(),
		User.findById(t.created_by).select({ email: 1 }).lean<{ email?: string }>(),
		t.assigned_to ? Admin.findById(t.assigned_to).select({ name: 1, email: 1 }).lean<{ name?: string; email?: string }>() : null,
	]);
	return {
		...ticketView(t),
		organization: { id: String(t.organization_id), name: org?.name ?? null, type: org?.type ?? null },
		created_by: { id: String(t.created_by), email: customer?.email ?? null },
		assigned_to: t.assigned_to ? { id: String(t.assigned_to), name: assignee?.name ?? null, email: assignee?.email ?? null } : null,
	};
};

export const adminListTickets = async (f: { status?: TicketStatus; organization_id?: string; assigned_to?: string; unassigned?: boolean; q?: string; page: number; limit: number }) => {
	const q: Record<string, unknown> = {};
	if (f.status) q.status = f.status;
	if (f.organization_id) q.organization_id = oid(f.organization_id);
	if (f.assigned_to) q.assigned_to = oid(f.assigned_to);
	if (f.unassigned) q.assigned_to = null;
	if (f.q) {
		const s = f.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		q.$or = [{ number: { $regex: `^${s}`, $options: 'i' } }, { subject: { $regex: s, $options: 'i' } }];
	}
	const [rows, total] = await Promise.all([SupportTicket.find(q).sort({ last_message_at: -1 }).skip((f.page - 1) * f.limit).limit(f.limit).lean<ISupportTicket[]>(), SupportTicket.countDocuments(q)]);
	return { tickets: await Promise.all(rows.map(teamView)), page: f.page, limit: f.limit, total };
};

export const adminCounts = async () => {
	const rows = await SupportTicket.aggregate<{ _id: TicketStatus; n: number }>([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
	const counts = Object.fromEntries(['open', 'in_progress', 'waiting_on_customer', 'resolved', 'closed'].map((s) => [s, 0])) as Record<TicketStatus, number>;
	for (const r of rows) counts[r._id] = r.n;
	const unassigned = await SupportTicket.countDocuments({ assigned_to: null, status: { $in: ['open', 'in_progress'] } });
	return { ...counts, unassigned_open: unassigned };
};

export const adminGetTicket = async (ticketId: string) => {
	const t = await loadForTeam(ticketId);
	return { ...(await teamView(t)), thread: await thread(t, true) };
};

export const adminReply = async (actor: TeamActor, ticketId: string, input: { message: string; internal?: boolean }, now: Date = new Date()) => {
	const t = await loadForTeam(ticketId);
	if (t.status === 'closed' && !input.internal) throw apiErrorWithData(httpStatus.CONFLICT, 'This ticket is closed.', { reason: 'ticket_closed' });
	await SupportMessage.create({ ticket_id: t._id, author: { kind: 'admin', id: new Types.ObjectId(actor.id), name: actor.name }, body: input.message, internal: Boolean(input.internal) });
	const set: Record<string, unknown> = input.internal ? {} : { status: 'waiting_on_customer', last_message_at: now, last_message_by: 'team' };
	if (!t.assigned_to) set.assigned_to = new Types.ObjectId(actor.id);
	const updated = (await SupportTicket.findByIdAndUpdate(t._id, { $set: set, $inc: { messages: 1 } }, { new: true }).lean<ISupportTicket>()) as ISupportTicket;
	if (!input.internal) await email(await customerEmailOf(t), `Re: ${t.subject} [${t.number}]`, ['The MyPageSEO team replied to your support ticket:', input.message, `View and reply: ${appLink(t)}`]);
	return { ...(await teamView(updated)), thread: await thread(updated, true) };
};

export const adminUpdate = async (ticketId: string, input: { status?: TicketStatus; priority?: TicketPriority; assigned_to?: string | null }, now: Date = new Date()) => {
	const t = await loadForTeam(ticketId);
	const set: Record<string, unknown> = {};
	if (input.status) {
		set.status = input.status;
		set.closed_at = input.status === 'closed' ? now : null;
	}
	if (input.priority) set.priority = input.priority;
	if (input.assigned_to !== undefined) {
		if (input.assigned_to && !(await Admin.exists({ _id: oid(input.assigned_to), is_active: true }))) {
			throw apiErrorWithData(httpStatus.BAD_REQUEST, 'Unknown admin.', { reason: 'unknown_admin' });
		}
		set.assigned_to = input.assigned_to ? new Types.ObjectId(input.assigned_to) : null;
	}
	const updated = (await SupportTicket.findByIdAndUpdate(t._id, { $set: set }, { new: true }).lean<ISupportTicket>()) as ISupportTicket;
	return teamView(updated);
};

export const openTicketCount = (): Promise<number> => SupportTicket.countDocuments({ status: { $in: ['open', 'in_progress', 'waiting_on_customer'] } });

export type { Id };
