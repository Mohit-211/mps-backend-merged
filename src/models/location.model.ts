import mongoose, { Schema, Model, Document } from "mongoose";
import {
  addTimestamps,
  globalQueryFilters,
  toJSON,
} from "../configs/mongoPlugins";
import httpStatus from "http-status";
import { ApiError } from "../utils";

export interface ILocation extends Document {
  name: string;
  address: string;
    lat?: number;
  lng?: number;
  country: string;
  state: string;
  city: string;
  zip_code: string;
  mobile: string;
  place_id: string;
  website_URL: string;
  business_category: string;
  client_id?: Schema.Types.ObjectId;
  is_active: boolean;
  created_at: Date;
  created_by?: Schema.Types.ObjectId;
  updated_at: Date;
  updated_by?: Schema.Types.ObjectId;
  deleted_at?: Date;
  deleted_by?: Schema.Types.ObjectId;
}

interface IModelLocation extends Model<ILocation> {
  toggleIsActiveById(locationId: string): Promise<string>;
}

const locationSchema = new Schema<ILocation>(
  {
    name: {
      type: String,
      trim: true,
      required: true,
    },
    address: {
      type: String,
      trim: true,
      required: true,
    },
    lat: {
      type: Number,
      default: null,
    },
    lng: {
      type: Number,
      default: null,
    },
    country: {
      type: String,
      trim: true,
      required: true,
    },
    state: {
      type: String,
      trim: true,
      required: true,
    },
    city: {
      type: String,
      trim: true,
      required: true,
    },
    zip_code: {
      type: String,
      trim: true,
      required: true,
    },
    mobile: {
      type: String,
      trim: true,
      required: true,
    },
    place_id: {
      type: String,
      trim: true,
      default: null,
    },
    website_URL: {
      type: String,
      trim: true,
      required: true,
    },
    business_category: {
      type: String,
      trim: true,
      required: true,
    },
    client_id: {
      type: Schema.Types.ObjectId,
      ref: "Client",
      required: false,
      default: null,
    },
    is_active: {
      type: Boolean,
      default: true,
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
    collection: "locations",
  }
);

locationSchema.plugin(globalQueryFilters);
locationSchema.plugin(toJSON);
locationSchema.plugin(addTimestamps);

locationSchema.statics.toggleIsActiveById = async function (
  locationId: string
): Promise<string> {
  try {
    const clinet = await this.findOne({ _id: locationId, is_active: true });
    if (!clinet) {
      throw new ApiError(httpStatus.NOT_FOUND, "Location not found");
    }
    clinet.is_active = !clinet.is_active;
    await clinet.save();
    return `Location is now ${clinet.is_active ? "active" : "inactive"}`;
  } catch (error) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message || "Error toggling location status"
    );
  }
};

export const Location: IModelLocation = mongoose.model<
  ILocation,
  IModelLocation
>("Location", locationSchema);
