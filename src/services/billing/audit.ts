import { Types } from 'mongoose';
import { AuditLog } from '../../models';

// Admin audit log (Phase 13a): every billing override and admin action, before → after.

export interface AuditActor {
	id: string;
	name: string | null;
}

export const audit = async (
	actor: AuditActor,
	entry: { action: string; organization_id?: Types.ObjectId | string | null; target?: string | null; before?: unknown; after?: unknown; note?: string | null },
	at: Date = new Date(),
): Promise<void> => {
	await AuditLog.create({
		actor: { admin_id: actor.id ? new Types.ObjectId(actor.id) : null, name: actor.name },
		organization_id: entry.organization_id ? new Types.ObjectId(String(entry.organization_id)) : null,
		action: entry.action,
		target: entry.target ?? null,
		before: entry.before ?? null,
		after: entry.after ?? null,
		note: entry.note ?? null,
		at,
	});
};
