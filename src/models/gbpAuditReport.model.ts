import mongoose, { Document, Model, Schema } from 'mongoose';
import { ApiError } from '../utils';
import httpStatus from 'http-status';
import {
  addTimestamps,
  globalQueryFilters,
  toJSON,
} from '../configs/mongoPlugins';
import { membershipType, membershipTypeArr } from '../configs/constantTypes';

export interface IGBPScheduling {
  frequency?: string;
  run_time?: {
    start_time?: string;
    end_time?: string;
  };
  run_at?: string;
  time_zone?: string;
}

export interface IGBPAuditReport extends Document {
  location_id: Schema.Types.ObjectId;
  scheduling?: IGBPScheduling;
  keyword_list: string[];
  keywords?: Record<string, any>;
  place_details?: Record<string, any>;
  nap_comparison?: Record<string, any>;
  is_active: boolean;
  created_at: Date;
  created_by?: Schema.Types.ObjectId;
  updated_at: Date;
  updated_by?: Schema.Types.ObjectId;
  deleted_at?: Date;
  deleted_by?: Schema.Types.ObjectId;
}

interface IGBPAuditReportModel extends Model<IGBPAuditReport> {
  toggleIsActiveById(gbpAuditReportId: string): Promise<string>;
}

const schedulingSchema = new Schema<IGBPScheduling>({
  frequency: { type: String, enum: membershipTypeArr, required: true, default: membershipType.MONTHLY },
  run_time: {
    start_time: { type: String, required: true },
    end_time: { type: String, required: true },
  },
  run_at: { type: String, required: true, default: '1' },
  time_zone: { type: String, default: null },
});

const gbpAuditReportSchema = new Schema<IGBPAuditReport>(
  {
    location_id: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
    scheduling: schedulingSchema,
    keyword_list : {type: [String], required: true},
    keywords: {type: Object, default: null},
    place_details: {type: Object, default: null},
    nap_comparison: {type: Object, default: null},
    is_active: { type: Boolean, default: true },
    created_at: { type: Date, default: Date.now },
    created_by: { type: Schema.Types.ObjectId, default: null },
    updated_at: { type: Date, default: Date.now },
    updated_by: { type: Schema.Types.ObjectId, default: null },
    deleted_at: { type: Date, default: null },
    deleted_by: { type: Schema.Types.ObjectId, default: null },
  },
  {
    collection: 'gbp_audit_reports',
  }
);

gbpAuditReportSchema.plugin(globalQueryFilters);
gbpAuditReportSchema.plugin(toJSON);
gbpAuditReportSchema.plugin(addTimestamps);

gbpAuditReportSchema.statics.toggleIsActiveById = async function (
  gbpAuditReportId: string,
): Promise<string> {
  try {
    const gbpAuditReport = await this.findOne({ _id: gbpAuditReportId });
    if (!gbpAuditReport) {
      throw new ApiError(httpStatus.NOT_FOUND, 'GBPAuditReport not found');
    }
    gbpAuditReport.is_active = !gbpAuditReport.is_active;
    await gbpAuditReport.save();
    return `GBPAuditReport is now ${gbpAuditReport.is_active ? 'active' : 'inactive'}`;
  } catch (error) {
    throw new ApiError(
      error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
      error.message || 'Error toggling gbpAuditReport status',
    );
  }
};

export const GBPAuditReport: IGBPAuditReportModel = mongoose.model<IGBPAuditReport, IGBPAuditReportModel>(
  'GBPAuditReport',
  gbpAuditReportSchema,
);
