import mongoose, { Document, Model, Schema } from 'mongoose';
import { ApiError } from '../utils';
import httpStatus from 'http-status';
import {
  addTimestamps,
  globalQueryFilters,
  toJSON,
} from '../configs/mongoPlugins';
import { membershipType, membershipTypeArr } from '../configs/constantTypes';


interface ISchedulingMap {
  frequency?: string;
  run_time?: {
    start_time?: string;
    end_time?: string;
  };
  run_at?: string;
  time_zone?: string;
}

interface IMapCriteria {
    latitude: number;
    longitude: number;
}

export interface ILocalMapRankingReport extends Document {
  location_id: Schema.Types.ObjectId;
  keywords_up: number;
  keywords_down: number;
  all_keywords_avg: string;
  scheduling: ISchedulingMap;
  keyword_list: string[];
  map_criteria: IMapCriteria;
  keywords?: Schema.Types.Mixed;
  total_keywords: number;
  is_active: boolean;
  created_at: Date;
  created_by?: Schema.Types.ObjectId;
  updated_at: Date;
  updated_by?: Schema.Types.ObjectId;
  deleted_at?: Date;
  deleted_by?: Schema.Types.ObjectId;
}

interface ILocalMapRankingReportModel extends Model<ILocalMapRankingReport> {
  toggleIsActiveById(localMapRankingReportId: string): Promise<string>;
}

const mapCriteriaSchema = new Schema<IMapCriteria>({
  latitude: { type: Number, required: true },
  longitude: { type: Number, required: true },
});

const schedulingSchema = new Schema<ISchedulingMap>({
  frequency: { type: String, enum: membershipTypeArr, required: true, default: membershipType.MONTHLY },
  run_time: {
    start_time: { type: String, required: true },
    end_time: { type: String, required: true },
  },
  run_at: { type: String, required: true, default: '1' },
  time_zone: { type: String, default: null },
});

const localMapRankingReportSchema = new Schema<ILocalMapRankingReport>(
  {
    location_id: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
    keywords_up: {type: Number, default: 0},
    keywords_down: {type: Number, default: 0},
    total_keywords: {type: Number, default: 0},
    all_keywords_avg: {type: String, default: ''},
    scheduling: schedulingSchema,
    map_criteria: mapCriteriaSchema,
    keyword_list : {type: [String], required: true},
    keywords: { type: Schema.Types.Mixed },


    is_active: { type: Boolean, default: true },
    created_at: { type: Date, default: Date.now },
    created_by: { type: Schema.Types.ObjectId, default: null },
    updated_at: { type: Date, default: Date.now },
    updated_by: { type: Schema.Types.ObjectId, default: null },
    deleted_at: { type: Date, default: null },
    deleted_by: { type: Schema.Types.ObjectId, default: null },
  },
  {
    collection: 'local_map_ranking_reports',
  }
);

localMapRankingReportSchema.plugin(globalQueryFilters);
localMapRankingReportSchema.plugin(toJSON);
localMapRankingReportSchema.plugin(addTimestamps);

localMapRankingReportSchema.statics.toggleIsActiveById = async function (
  localMapRankingReportId: string,
): Promise<string> {
  try {
    const localMapRankingReport = await this.findOne({ _id: localMapRankingReportId, is_active: true });
    if (!localMapRankingReport) {
      throw new ApiError(httpStatus.NOT_FOUND, 'LocalMapRankingReport not found');
    }
    localMapRankingReport.is_active = !localMapRankingReport.is_active;
    await localMapRankingReport.save();
    return `LocalMapRankingReport is now ${localMapRankingReport.is_active ? 'active' : 'inactive'}`;
  } catch (error) {
    throw new ApiError(
      error.statusCode
        ? error.statusCode
        : httpStatus.INTERNAL_SERVER_ERROR,
      error.message || 'Error toggling localMapRankingReport status',
    );
  }
};

export const LocalMapRankingReport: ILocalMapRankingReportModel = mongoose.model<ILocalMapRankingReport, ILocalMapRankingReportModel>(
  'LocalMapRankingReport',
  localMapRankingReportSchema,
);
