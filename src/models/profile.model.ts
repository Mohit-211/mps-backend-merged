import mongoose, { Document, Schema, Model } from "mongoose";
import { ApiError } from "../utils";
import httpStatus from "http-status";
import {
  addTimestamps,
  globalQueryFilters,
  toJSON,
} from "../configs/mongoPlugins";

export interface IProfile extends Document {
  user_id: Schema.Types.ObjectId;
  name?: string;
  country?: string;
  state?: string;
  city?: string;
  business_name?: string;
  business_address?: string;
  website_url?: string;
  zip_code?: string | null;
  about?: string | null;
  overall_ratings: number;
  no_of_user_rated: number;
  no_of_user_reviewed: number;
  no_of_clients: number;
  no_of_locations: number;
  mobile?: string;
  is_active: boolean;
  created_at: Date;
  created_by?: Schema.Types.ObjectId;
  updated_at: Date;
  updated_by?: Schema.Types.ObjectId;
  deleted_at?: Date;
  deleted_by?: Schema.Types.ObjectId;
}

interface IProfileModel extends Model<IProfile> {
  getById(profileId: string): Promise<IProfile | null>;
  deleteById(profileId: string): Promise<void>;
  getAll(limit: number, offset: number): Promise<IProfile[]>;
  updateById(
    profileId: string,
    updates: Partial<IProfile>
  ): Promise<IProfile | null>;
  toggleIsActiveById(profileId: string): Promise<string>;
}

const profileSchema = new Schema<IProfile>(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    name: {
      type: String,
      trim: true,
      required: true,
    },
    country: {
      type: String,
      trim: true,
      default: null,
    },
    state: {
      type: String,
      trim: true,
      default: null,
    },
    city: {
      type: String,
      trim: true,
      default: null,
    },
    business_name: {
      type: String,
      trim: true,
      default: null,
    },
    business_address: {
      type: String,
      trim: true,
      default: null,
    },
    zip_code: {
      type: String,
      trim: true,
      default: null,
    },
    website_url: {
      type: String,
      trim: true,
      default: null,
    },
    about: {
      type: String,
      trim: true,
      default: null,
    },
    overall_ratings: {
      type: Number,
      default: 0,
    },
    no_of_user_rated: {
      type: Number,
      default: 0,
    },
    no_of_user_reviewed: {
      type: Number,
      default: 0,
    },
    no_of_clients: {
      type: Number,
      default: 0,
    },
    no_of_locations: {
      type: Number,
      default: 0,
    },
    mobile: {
      type: String,
      trim: true,
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
    collection: "profiles",
  }
);

profileSchema.plugin(globalQueryFilters);
profileSchema.plugin(toJSON);
profileSchema.plugin(addTimestamps);

profileSchema.statics.getById = async function (
  profileId: string
): Promise<IProfile | null> {
  try {
    return await this.findOne({ _id: profileId, is_active: true });
  } catch (error) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

profileSchema.statics.deleteById = async function (
  profileId: string
): Promise<void> {
  try {
    const profile = await this.findOneAndUpdate(
      { _id: profileId, is_active: true },
      { is_active: false, deleted_at: new Date() },
      { new: true }
    );
    if (!profile) {
      throw new ApiError(httpStatus.NOT_FOUND, "Profile not found");
    }
  } catch (error) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

profileSchema.statics.getAll = async function (
  limit: number,
  offset: number
): Promise<IProfile[]> {
  try {
    return await this.find({ is_active: true })
      .limit(limit)
      .skip(offset)
      .sort({ created_at: -1 });
  } catch (error) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

profileSchema.statics.updateById = async function (
  profileId: string,
  updates: Partial<IProfile>
): Promise<IProfile | null> {
  try {
    return await this.findOneAndUpdate(
      { _id: profileId, is_active: true },
      updates,
      { new: true }
    );
  } catch (error) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

profileSchema.statics.toggleIsActiveById = async function (
  profileId: string
): Promise<string> {
  try {
    const profile = await this.findOne({ _id: profileId, is_active: true });
    if (!profile) {
      throw new ApiError(httpStatus.NOT_FOUND, "Profile not found");
    }
    profile.is_active = !profile.is_active;
    await profile.save();
    return `Profile is now ${profile.is_active ? "active" : "inactive"}`;
  } catch (error) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message || "Error toggling profile status"
    );
  }
};

export const Profile: IProfileModel = mongoose.model<IProfile, IProfileModel>(
  "Profile",
  profileSchema
);
