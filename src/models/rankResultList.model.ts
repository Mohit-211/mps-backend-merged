import { Document, Model, Schema, Types, model } from 'mongoose';

// Full result lists of a rank run (Phase 12.5): one document per (run, keyword). Every point and
// sample's ordered list of place IDs (up to 60) is stored compactly: `places` is the keyword's
// dictionary of distinct IDs in this run, and each list is a Binary of uint16 indexes into it, in rank
// order. Decode with services/ranking/resultLists.ts. IDs only (storable under the Maps terms).

export interface ResultListPoint {
	/** 'C' | 'N' | 'S' | 'E' | 'W' for tracker points, 'g:<row>,<col>' for grid points. */
	point: string;
	sample: number;
	/** null when the search failed. */
	result_count: number | null;
	ids: Buffer | null;
}

export interface IRankResultList extends Document {
	run_id: Types.ObjectId;
	location_id: Types.ObjectId;
	keyword: string;
	places: string[];
	points: ResultListPoint[];
	created_at: Date;
}

const RankResultListSchema = new Schema<IRankResultList>(
	{
		run_id: { type: Schema.Types.ObjectId, ref: 'RankRun', required: true },
		location_id: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
		keyword: { type: String, required: true },
		places: { type: [String], default: [] },
		points: {
			type: [{ _id: false, point: String, sample: Number, result_count: { type: Number, default: null }, ids: { type: Buffer, default: null } }],
			default: [],
		},
	},
	{ collection: 'rank_result_lists', timestamps: { createdAt: 'created_at', updatedAt: false } },
);
RankResultListSchema.index({ run_id: 1, keyword: 1 }, { unique: true });
RankResultListSchema.index({ location_id: 1, created_at: -1 });

export const RankResultList: Model<IRankResultList> = model<IRankResultList>('RankResultList', RankResultListSchema);
