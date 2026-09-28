import { Document, Model, Schema, Types, model } from 'mongoose';
import { LEDGER_TYPES, LedgerType } from '../billing/constants';

// The token ledger (Phase 13a): every purchase, spend, refund, grant and adjustment, with the balance
// after it. The balance itself is Organization.token_balance (atomic $inc).

export interface LedgerActor {
	kind: 'user' | 'admin' | 'system';
	id: Types.ObjectId | null;
	name: string | null;
}

export interface ITokenLedger extends Document {
	_id: Types.ObjectId;
	organization_id: Types.ObjectId;
	type: LedgerType;
	amount: number;
	balance_after: number;
	/** What caused it: an order, a rank run, a GBP sync, an invoice (kind:id). */
	ref: string | null;
	location_id: Types.ObjectId | null;
	actor: LedgerActor;
	note: string | null;
	expires_at: Date | null;
	at: Date;
}

const TokenLedgerSchema = new Schema<ITokenLedger>(
	{
		organization_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
		type: { type: String, enum: LEDGER_TYPES, required: true },
		amount: { type: Number, required: true },
		balance_after: { type: Number, required: true },
		ref: { type: String, default: null },
		location_id: { type: Schema.Types.ObjectId, ref: 'Location', default: null },
		actor: { kind: { type: String, enum: ['user', 'admin', 'system'], default: 'system' }, id: { type: Schema.Types.ObjectId, default: null }, name: { type: String, default: null } },
		note: { type: String, default: null },
		expires_at: { type: Date, default: null },
		at: { type: Date, required: true },
	},
	{ collection: 'token_ledger' },
);
TokenLedgerSchema.index({ organization_id: 1, at: -1 });
// Written once per reference: a refund per spend, a monthly grant per payment / period, an expiry per purchase.
TokenLedgerSchema.index({ ref: 1, type: 1 }, { unique: true, partialFilterExpression: { type: { $in: ['refund', 'monthly_grant', 'expiry'] }, ref: { $type: 'string' } } });

export const TokenLedger: Model<ITokenLedger> = model<ITokenLedger>('TokenLedger', TokenLedgerSchema);
