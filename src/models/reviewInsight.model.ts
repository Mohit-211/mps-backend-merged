import { Document, Model, Schema, Types, model } from 'mongoose';

// Review insights (Phase 18): one stored AI summary per location, regenerated only when the user asks.

export interface ReviewInsightData {
	themes: { theme: string; mentions: number; sentiment: 'positive' | 'negative' | 'mixed' }[];
	praise: string[];
	complaints: string[];
	observations: string[];
}

export interface IReviewInsight extends Document {
	location_id: Types.ObjectId;
	generated_at: Date;
	generated_by: Types.ObjectId | null;
	ai_model: string;
	/** What the AI saw: review counts and the window. */
	basis: { reviews_total: number; reviews_sent: number; from: Date | null; to: Date | null };
	insight: ReviewInsightData;
}

const ReviewInsightSchema = new Schema<IReviewInsight>(
	{
		location_id: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
		generated_at: { type: Date, required: true },
		generated_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
		ai_model: { type: String, required: true },
		basis: { type: Schema.Types.Mixed, default: {} },
		insight: { type: Schema.Types.Mixed, required: true },
	},
	{ collection: 'review_insights', minimize: false },
);
ReviewInsightSchema.index({ location_id: 1 }, { unique: true });

export const ReviewInsight: Model<IReviewInsight> = model<IReviewInsight>('ReviewInsight', ReviewInsightSchema);
