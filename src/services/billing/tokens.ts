import httpStatus from 'http-status';
import { Types } from 'mongoose';
import logger from '../../configs/logger';
import { LedgerType } from '../../billing/constants';
import { ITokenLedger, LedgerActor, Organization, TokenLedger } from '../../models';
import { apiErrorWithData } from '../../utils';

// The token ledger (Phase 13a). Organization.token_balance changes only here, with atomic $inc; a spend
// is conditional on the balance. Refunds are written once per spend (unique ref), so hooks can retry.

type Id = Types.ObjectId | string;

export const SYSTEM: LedgerActor = { kind: 'system', id: null, name: null };

const write = async (organizationId: Id, type: LedgerType, amount: number, balanceAfter: number, extra: { ref?: string | null; location_id?: Id | null; actor?: LedgerActor; note?: string | null; expires_at?: Date | null }, at: Date) =>
	TokenLedger.create({
		organization_id: organizationId,
		type,
		amount,
		balance_after: balanceAfter,
		ref: extra.ref ?? null,
		location_id: extra.location_id ?? null,
		actor: extra.actor ?? SYSTEM,
		note: extra.note ?? null,
		expires_at: extra.expires_at ?? null,
		at,
	});

/** Adds (or, for adjustments, removes) tokens. Balances never go below zero. A duplicate once-per-reference
 * entry throws the E11000 error with the balance unchanged. */
export const credit = async (
	organizationId: Id,
	type: Exclude<LedgerType, 'spend'>,
	amount: number,
	extra: { ref?: string | null; location_id?: Id | null; actor?: LedgerActor; note?: string | null; expires_at?: Date | null } = {},
	at: Date = new Date(),
): Promise<number> => {
	if (amount === 0) return (await Organization.findById(organizationId).select({ token_balance: 1 }).lean<{ token_balance?: number }>())?.token_balance ?? 0;
	const filter: Record<string, unknown> = { _id: organizationId };
	if (amount < 0) filter.token_balance = { $gte: -amount };
	const org = await Organization.findOneAndUpdate(filter, { $inc: { token_balance: amount } }, { new: true }).select({ token_balance: 1 }).lean<{ token_balance: number }>();
	if (!org) throw apiErrorWithData(httpStatus.CONFLICT, 'The adjustment would make the balance negative.', { reason: 'insufficient_tokens' });
	try {
		await write(organizationId, type, amount, org.token_balance, extra, at);
	} catch (err) {
		// A once-per-reference entry (refund, monthly grant, expiry) already exists: undo the balance change.
		await Organization.updateOne({ _id: organizationId }, { $inc: { token_balance: -amount } });
		throw err;
	}
	return org.token_balance;
};

export interface SpendResult {
	ok: boolean;
	balance: number;
	entry_id: string | null;
}

/** Spends `cost` tokens atomically; ok=false (nothing spent) when the balance is too low. A cost of 0 is free. */
export const spend = async (organizationId: Id, cost: number, extra: { ref?: string | null; location_id?: Id | null; actor?: LedgerActor; note?: string | null }, at: Date = new Date()): Promise<SpendResult> => {
	if (cost <= 0) {
		const b = (await Organization.findById(organizationId).select({ token_balance: 1 }).lean<{ token_balance?: number }>())?.token_balance ?? 0;
		return { ok: true, balance: b, entry_id: null };
	}
	const org = await Organization.findOneAndUpdate({ _id: organizationId, token_balance: { $gte: cost } }, { $inc: { token_balance: -cost } }, { new: true }).select({ token_balance: 1 }).lean<{ token_balance: number }>();
	if (!org) {
		const b = (await Organization.findById(organizationId).select({ token_balance: 1 }).lean<{ token_balance?: number }>())?.token_balance ?? 0;
		return { ok: false, balance: b, entry_id: null };
	}
	const entry = await write(organizationId, 'spend', -cost, org.token_balance, extra, at);
	return { ok: true, balance: org.token_balance, entry_id: String(entry._id) };
};

/** Points a spend at what it paid for (the rank run / GBP sync id), so a failure can refund it. */
export const linkSpend = async (entryId: string, ref: string): Promise<void> => {
	await TokenLedger.updateOne({ _id: entryId, type: 'spend' }, { $set: { ref } });
};

/** Refunds the spend recorded for `ref` (once). Returns the tokens refunded (0 if none or already refunded). */
export const refundSpend = async (ref: string, note: string, at: Date = new Date()): Promise<number> => {
	const spent = await TokenLedger.findOne({ ref, type: 'spend' }).lean<ITokenLedger>();
	if (!spent || spent.amount >= 0) return 0;
	if (await TokenLedger.exists({ ref, type: 'refund' })) return 0;
	try {
		await credit(spent.organization_id, 'refund', -spent.amount, { ref, location_id: spent.location_id, note }, at);
	} catch (err) {
		if ((err as { code?: number }).code === 11000) return 0; // a parallel refund won (credit undid its $inc)
		throw err;
	}
	logger.info(`billing: refunded ${-spent.amount} tokens for ${ref}`);
	return -spent.amount;
};

export const ledgerView = (e: ITokenLedger) => ({
	id: String(e._id),
	type: e.type,
	amount: e.amount,
	balance_after: e.balance_after,
	ref: e.ref,
	location_id: e.location_id ? String(e.location_id) : null,
	note: e.note,
	by: e.actor?.kind === 'admin' ? 'MyPageSEO team' : e.actor?.kind === 'user' ? 'user' : 'system',
	at: e.at,
});

/** A once-per-reference credit (monthly grant, …): returns false when it was already written. */
export const creditOnce = async (organizationId: Id, type: 'monthly_grant' | 'grant', amount: number, ref: string, note: string, at: Date = new Date()): Promise<boolean> => {
	if (amount <= 0 || (await TokenLedger.exists({ ref, type }))) return false;
	try {
		await credit(organizationId, type, amount, { ref, note }, at);
		return true;
	} catch (err) {
		if ((err as { code?: number }).code === 11000) return false;
		throw err;
	}
};
