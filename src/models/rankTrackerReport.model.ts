import mongoose, { Document, Model, Schema } from 'mongoose';
import { ApiError } from '../utils';
import httpStatus from 'http-status';
import {
  addTimestamps,
  globalQueryFilters,
  toJSON,
} from '../configs/mongoPlugins';
import { membershipType, membershipTypeArr } from '../configs/constantTypes';

export interface ICompetitor {
  name: string;
  website: string;
  place_id?: string;
  rank?: number;
  change?: number;
  lat?: number;
  lng?: number;
  phone?: string;
}

export interface IKeyword {
  name: string;
  volume?: number;
  organic_desktop?: IRankDetails;
  organic_mobile?: IRankDetails;
  local_pack?: IRankDetails;
  local_finder?: IRankDetails;
}

export interface IRankDetails {
  rank?: number;
  change?: number;
  competitors?: ICompetitor[];
}

export interface IKeywordAndPositionalMovement {
  keyword_movement?: IKeyMovement;
  positional_movement?: IPosMovement;
}

export interface IKeyMovement {
  up?: number;
  down?: number;
  change?: number;
  no_change?: number;
  new_ranking?: number;
  total?: number;
};

export interface IPosMovement {
  gained?: number;
  lost?: number;
  change?: number;
}

export interface IScheduling {
  frequency?: string;
  run_time?: {
    start_time?: string;
    end_time?: string;
  };
  run_at?: string;
  time_zone?: string;
}

export interface IRankTrackerReport extends Document {
  location_id: Schema.Types.ObjectId;
  scheduling?: IScheduling;
  competitors?: ICompetitor[];
  keyword_list: string[];
  average_google_position?: any;
  google_local_pack_coverage?: string;
  placeTargets?: any;
  avgRanking?: any;
  keyword_and_positional_movement?: IKeywordAndPositionalMovement;
  keywords?: IKeyword[];
  total_keywords: number;
  is_active: boolean;
  created_at: Date;
  created_by?: Schema.Types.ObjectId;
  updated_at: Date;
  updated_by?: Schema.Types.ObjectId;
  deleted_at?: Date;
  deleted_by?: Schema.Types.ObjectId;
}

interface IRankTrackerReportModel extends Model<IRankTrackerReport> {
  toggleIsActiveById(rankTrackerReportId: string): Promise<string>;
}

const competitorSchema = new Schema<ICompetitor>({
  name: { type: String, required: true },
  place_id: { type: String, default: null },
  website: { type: String, default: null },
  rank: { type: Number, default: null },
  change: { type: Number, default: null },
  lat: { type: Number, default: null },
  lng: { type: Number, default: null },
});

const rankDetailsSchema = new Schema<IRankDetails>({
  rank: { type: Number, default: null },
  change: { type: Number, default: null },
  competitors: [competitorSchema],
});

const keywordSchema = new Schema<IKeyword>({
  name: { type: String, required: true },
  volume: { type: Number, default: null },
  organic_desktop: rankDetailsSchema,
  organic_mobile: rankDetailsSchema,
  local_pack: rankDetailsSchema,
  local_finder: rankDetailsSchema,
});

const keyMovementSchema = new Schema<IKeyMovement>({
  up: { type: Number, default: null },
  down: { type: Number, default: null },
  change: { type: Number, default: null },
  no_change: { type: Number, default: null },
  total: { type: Number, default: 0 },
  new_ranking: { type: Number, default: 0 },
});

const posMovementSchema = new Schema<IPosMovement>({
  gained: { type: Number, default: null },
  lost: { type: Number, default: null },
  change: { type: Number, default: null },
});


const keywordAndPositionalMovementSchema = new Schema<IKeywordAndPositionalMovement>({
  keyword_movement: keyMovementSchema,
  positional_movement: posMovementSchema,
});

const schedulingSchema = new Schema<IScheduling>({
  frequency: { type: String, enum: membershipTypeArr, required: true, default: membershipType.MONTHLY },
  run_time: {
    start_time: { type: String, required: true },
    end_time: { type: String, required: true },
  },
  run_at: { type: String, required: true, default: '1' },
  time_zone: { type: String, default: null },
});

const rankTrackerReportSchema = new Schema<IRankTrackerReport>(
  {
    location_id: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
    scheduling: schedulingSchema,
    competitors: [competitorSchema],
    keyword_list: { type: [String], required: true },
    average_google_position: { type: Schema.Types.Mixed, default: null },
    avgRanking: { type: Schema.Types.Mixed, default: null },
    placeTargets: { type: Schema.Types.Mixed, default: null },
    google_local_pack_coverage: { type: String, default: null },
    keyword_and_positional_movement: keywordAndPositionalMovementSchema,
    keywords: [keywordSchema],
    total_keywords: { type: Number, default: 0 },
    is_active: { type: Boolean, default: true },
    created_at: { type: Date, default: Date.now },
    created_by: { type: Schema.Types.ObjectId, default: null },
    updated_at: { type: Date, default: Date.now },
    updated_by: { type: Schema.Types.ObjectId, default: null },
    deleted_at: { type: Date, default: null },
    deleted_by: { type: Schema.Types.ObjectId, default: null },
  },
  {
    collection: 'rank_tracker_reports',
  }
);

rankTrackerReportSchema.plugin(globalQueryFilters);
rankTrackerReportSchema.plugin(toJSON);
rankTrackerReportSchema.plugin(addTimestamps);

rankTrackerReportSchema.statics.toggleIsActiveById = async function (
  rankTrackerReportId: string,
): Promise<string> {
  try {
    const rankTrackerReport = await this.findOne({ _id: rankTrackerReportId, is_active: true });
    if (!rankTrackerReport) {
      throw new ApiError(httpStatus.NOT_FOUND, 'RankTrackerReport not found');
    }
    rankTrackerReport.is_active = !rankTrackerReport.is_active;
    await rankTrackerReport.save();
    return `RankTrackerReport is now ${rankTrackerReport.is_active ? 'active' : 'inactive'}`;
  } catch (error) {
    throw new ApiError(
      error.statusCode
        ? error.statusCode
        : httpStatus.INTERNAL_SERVER_ERROR,
      error.message || 'Error toggling rankTrackerReport status',
    );
  }
};

export const RankTrackerReport: IRankTrackerReportModel = mongoose.model<IRankTrackerReport, IRankTrackerReportModel>(
  'RankTrackerReport',
  rankTrackerReportSchema,
);
