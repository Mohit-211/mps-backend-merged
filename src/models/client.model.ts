import mongoose, { Schema, Model, Document } from "mongoose";
import {
  addTimestamps,
  globalQueryFilters,
  toJSON,
} from "../configs/mongoPlugins";
import httpStatus from "http-status";
import { ApiError } from "../utils";
import { userStatusTypes, userStatusTypesArr } from "../configs/constantTypes";

export interface IClient extends Document {
  company_name: string;
  company_URL: string;
  unique_id: string;
  status: string;
  is_active: boolean;
  no_of_locations: number;
  created_at: Date;
  created_by?: Schema.Types.ObjectId;
  updated_at: Date;
  updated_by?: Schema.Types.ObjectId;
  deleted_at?: Date;
  deleted_by?: Schema.Types.ObjectId;
}

interface IModelClient extends Model<IClient> {
  toggleIsActiveById(clientId: string): Promise<string>;
}

const clientSchema = new Schema<IClient>(
  {
    company_name: {
      type: String,
      trim: true,
      required: true,
    },
    company_URL: {
      type: String,
      trim: true,
      required: true,
    },
    unique_id: {
      type: String,
      trim: true,
      required: true,
    },
    status: {
      type: String,
      enum: userStatusTypesArr,
      default: userStatusTypes.ACTIVE,
    },
    is_active: {
      type: Boolean,
      default: true,
    },
    no_of_locations: {
      type: Number,
      default: 0,
    },
    created_at: {
      type: Date,
      default: Date.now,
    },
    created_by: {
      type: Schema.Types.ObjectId,
      default: null,
    },
    updated_at: {
      type: Date,
      default: Date.now,
    },
    updated_by: {
      type: Schema.Types.ObjectId,
      default: null,
    },
    deleted_at: {
      type: Date,
      default: null,
    },
    deleted_by: {
      type: Schema.Types.ObjectId,
      default: null,
    },
  },
  {
    collection: "clients",
  }
);

clientSchema.plugin(globalQueryFilters);
clientSchema.plugin(toJSON);
clientSchema.plugin(addTimestamps);

clientSchema.statics.toggleIsActiveById = async function (
  clientId: string
): Promise<string> {
  try {
    const clinet = await this.findOne({ _id: clientId, is_active: true });
    if (!clinet) {
      throw new ApiError(httpStatus.NOT_FOUND, "Client not found");
    }
    clinet.is_active = !clinet.is_active;
    await clinet.save();
    return `Client is now ${clinet.is_active ? "active" : "inactive"}`;
  } catch (error) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message || "Error toggling client status"
    );
  }
};

export const Client: IModelClient = mongoose.model<IClient, IModelClient>(
  "Client",
  clientSchema
);
