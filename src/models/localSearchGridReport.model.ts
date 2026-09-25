import mongoose, { Document, Model, Schema } from 'mongoose';
import { ApiError } from '../utils';
import httpStatus from 'http-status';
import {
  addTimestamps,
  globalQueryFilters,
  toJSON,
} from '../configs/mongoPlugins';
import { membershipType, membershipTypeArr } from '../configs/constantTypes';


interface ISchedulingGrid {
  frequency?: string;
  run_time?: {
    start_time?: string;
    end_time?: string;
  };
  run_at?: string;
  time_zone?: string;
}

export interface IMapCriteria {
    latitude: number;
    longitude: number;
    grid_size: number;
    spacing: number;
    unit: string;
    max_points: number;
}

export interface ILocalSearchGridReport extends Document {
  location_id: Schema.Types.ObjectId;
  keywords_up: number;
  keywords_down: number;
  all_keywords_avg: string;
  scheduling: ISchedulingGrid;
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

interface ILocalSearchGridReportModel extends Model<ILocalSearchGridReport> {
  toggleIsActiveById(localSearchGridReportId: string): Promise<string>;
}

const mapCriteriaSchema = new Schema<IMapCriteria>({
  latitude: { type: Number, required: true },
  longitude: { type: Number, required: true },
  grid_size: { type: Number, default: 5, min: 3, max: 7 },
  spacing: { type: Number, default: 100, min: 100 },
  unit: { type: String, default: 'meters' },
  max_points: { type: Number, default: 25, min: 9, max: 49 },
});

const schedulingSchema = new Schema<ISchedulingGrid>({
  frequency: { type: String, enum: membershipTypeArr, required: true, default: membershipType.MONTHLY },
  run_time: {
    start_time: { type: String, required: true },
    end_time: { type: String, required: true },
  },
  run_at: { type: String, required: true, default: '1' },
  time_zone: { type: String, default: null },
});

const localSearchGridReportSchema = new Schema<ILocalSearchGridReport>(
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
    collection: 'local_search_grid_reports',
  }
);

localSearchGridReportSchema.plugin(globalQueryFilters);
localSearchGridReportSchema.plugin(toJSON);
localSearchGridReportSchema.plugin(addTimestamps);

localSearchGridReportSchema.statics.toggleIsActiveById = async function (
  localSearchGridReportId: string,
): Promise<string> {
  try {
    const localSearchGridReport = await this.findOne({ _id: localSearchGridReportId, is_active: true });
    if (!localSearchGridReport) {
      throw new ApiError(httpStatus.NOT_FOUND, 'LocalSearchGridReport not found');
    }
    localSearchGridReport.is_active = !localSearchGridReport.is_active;
    await localSearchGridReport.save();
    return `LocalSearchGridReport is now ${localSearchGridReport.is_active ? 'active' : 'inactive'}`;
  } catch (error) {
    throw new ApiError(
      error.statusCode
        ? error.statusCode
        : httpStatus.INTERNAL_SERVER_ERROR,
      error.message || 'Error toggling localSearchGridReport status',
    );
  }
};

export const LocalSearchGridReport: ILocalSearchGridReportModel = mongoose.model<ILocalSearchGridReport, ILocalSearchGridReportModel>(
  'LocalSearchGridReport',
  localSearchGridReportSchema,
);
