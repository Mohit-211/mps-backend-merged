import { Document, Model, Schema, model } from 'mongoose';

// Sequential counters (Phase 13a): invoice numbers per year (`invoice:2026`), via atomic $inc.

export interface ICounter extends Document {
	key: string;
	value: number;
}

const CounterSchema = new Schema<ICounter>({ key: { type: String, required: true }, value: { type: Number, default: 0 } }, { collection: 'counters' });
CounterSchema.index({ key: 1 }, { unique: true });

export const Counter: Model<ICounter> = model<ICounter>('Counter', CounterSchema);
