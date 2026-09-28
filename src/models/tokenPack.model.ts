import { Document, Model, Schema, Types, model } from 'mongoose';
import { CURRENCIES, Currency } from '../billing/constants';

// Token packs (Phase 13a): admin-defined one-time purchases. Tokens never expire unless
// `expires_after_days` is set (off by default).

export interface ITokenPack extends Document {
	_id: Types.ObjectId;
	name: string;
	tokens: number;
	prices: { currency: Currency; price: number }[];
	expires_after_days: number | null;
	is_active: boolean;
	sort_order: number;
	created_at: Date;
	updated_at: Date;
}

const TokenPackSchema = new Schema<ITokenPack>(
	{
		name: { type: String, required: true, trim: true },
		tokens: { type: Number, required: true, min: 1 },
		prices: { type: [{ currency: { type: String, enum: CURRENCIES, required: true }, price: { type: Number, min: 0, required: true }, _id: false }], default: [] },
		expires_after_days: { type: Number, min: 1, default: null },
		is_active: { type: Boolean, default: true },
		sort_order: { type: Number, default: 0 },
	},
	{ collection: 'token_packs', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);
TokenPackSchema.index({ is_active: 1, sort_order: 1 });

export const TokenPack: Model<ITokenPack> = model<ITokenPack>('TokenPack', TokenPackSchema);
