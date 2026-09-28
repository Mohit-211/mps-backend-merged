import { Document, Model, Schema, Types, model } from 'mongoose';

// Support tickets (Phase 13b): organization-scoped, with a message thread (SupportMessage). Replaces the
// legacy `supports` collection (removed); the fresh database starts with no tickets.

export const TICKET_STATUSES = ['open', 'in_progress', 'waiting_on_customer', 'resolved', 'closed'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TICKET_CATEGORIES = ['billing', 'technical', 'account', 'data', 'other'] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];
export const TICKET_PRIORITIES = ['low', 'normal', 'high'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export interface ISupportTicket extends Document {
	_id: Types.ObjectId;
	/** TCK-000123 */
	number: string;
	organization_id: Types.ObjectId;
	created_by: Types.ObjectId;
	location_id: Types.ObjectId | null;
	subject: string;
	category: TicketCategory;
	status: TicketStatus;
	priority: TicketPriority;
	/** Platform admin handling it. */
	assigned_to: Types.ObjectId | null;
	last_message_at: Date;
	last_message_by: 'customer' | 'team';
	messages: number;
	closed_at: Date | null;
	created_at: Date;
	updated_at: Date;
}

const SupportTicketSchema = new Schema<ISupportTicket>(
	{
		number: { type: String, required: true },
		organization_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
		created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
		location_id: { type: Schema.Types.ObjectId, ref: 'Location', default: null },
		subject: { type: String, required: true, trim: true, maxlength: 200 },
		category: { type: String, enum: TICKET_CATEGORIES, default: 'other' },
		status: { type: String, enum: TICKET_STATUSES, default: 'open' },
		priority: { type: String, enum: TICKET_PRIORITIES, default: 'normal' },
		assigned_to: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
		last_message_at: { type: Date, required: true },
		last_message_by: { type: String, enum: ['customer', 'team'], required: true },
		messages: { type: Number, default: 0 },
		closed_at: { type: Date, default: null },
	},
	{ collection: 'support_tickets', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);
SupportTicketSchema.index({ number: 1 }, { unique: true });
SupportTicketSchema.index({ organization_id: 1, last_message_at: -1 });
SupportTicketSchema.index({ status: 1, last_message_at: -1 });
SupportTicketSchema.index({ assigned_to: 1, status: 1 });

export const SupportTicket: Model<ISupportTicket> = model<ISupportTicket>('SupportTicket', SupportTicketSchema);

export interface ISupportMessage extends Document {
	_id: Types.ObjectId;
	ticket_id: Types.ObjectId;
	author: { kind: 'user' | 'admin'; id: Types.ObjectId; name: string | null };
	body: string;
	/** Team-only note: never shown to the customer. */
	internal: boolean;
	created_at: Date;
}

const SupportMessageSchema = new Schema<ISupportMessage>(
	{
		ticket_id: { type: Schema.Types.ObjectId, ref: 'SupportTicket', required: true },
		author: {
			kind: { type: String, enum: ['user', 'admin'], required: true },
			id: { type: Schema.Types.ObjectId, required: true },
			name: { type: String, default: null },
		},
		body: { type: String, required: true, maxlength: 10000 },
		internal: { type: Boolean, default: false },
	},
	{ collection: 'support_messages', timestamps: { createdAt: 'created_at', updatedAt: false } },
);
SupportMessageSchema.index({ ticket_id: 1, created_at: 1 });

export const SupportMessage: Model<ISupportMessage> = model<ISupportMessage>('SupportMessage', SupportMessageSchema);
