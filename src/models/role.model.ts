import mongoose, { Document, Model, Schema } from "mongoose";
import { ApiError } from "../utils";
import httpStatus from "http-status";
import { roleSelect } from "../constants";
import {
  addTimestamps,
  globalQueryFilters,
  toJSON,
} from "../configs/mongoPlugins";

export interface IRole extends Document {
  name: string;
  role_id: number;
  abbreviation: string;
  is_active: boolean;
  created_at: Date;
  created_by?: Schema.Types.ObjectId;
  updated_at: Date;
  updated_by?: Schema.Types.ObjectId;
  deleted_at?: Date;
  deleted_by?: Schema.Types.ObjectId;
}

interface IRoleModel extends Model<IRole> {
  getById(roleId: string): Promise<IRole | null>;
  deleteById(roleId: string): Promise<void>;
  getAll(limit: number, offset: number): Promise<IRole[]>;
  updateById(roleId: string, updates: Partial<IRole>): Promise<IRole | null>;
  toggleIsActiveById(roleId: string): Promise<string>;
}

const roleSchema = new Schema<IRole>(
  {
    role_id: {
      type: Number,
      unique: true,
      required: true,
      trim: true,
    },
    name: {
      type: String,
      trim: true,
      required: true,
    },
    abbreviation: {
      type: String,
      trim: true,
      required: true,
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
    collection: "roles",
  }
);

roleSchema.plugin(globalQueryFilters);
roleSchema.plugin(toJSON);
roleSchema.plugin(addTimestamps);

roleSchema.statics.getById = async function (
  roleId: string
): Promise<IRole | null> {
  try {
    return await this.findOne({ role_id: roleId, is_active: true }).select(
      roleSelect
    );
  } catch (error) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

roleSchema.statics.deleteById = async function (roleId: string): Promise<void> {
  try {
    const role = await this.findOneAndUpdate(
      { role_id: roleId, is_active: true },
      { is_active: false, deleted_at: new Date() },
      { new: true }
    );
    if (!role) {
      throw new ApiError(httpStatus.NOT_FOUND, "Role not found");
    }
  } catch (error) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

roleSchema.statics.getAll = async function (
  limit: number,
  offset: number
): Promise<IRole[]> {
  try {
    return await this.find({ is_active: true })
      .select(roleSelect)
      .limit(limit)
      .skip(offset)
      .sort({ role_id: 1 });
  } catch (error) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

roleSchema.statics.updateById = async function (
  roleId: string,
  updates: Partial<IRole>
): Promise<IRole | null> {
  try {
    if (!updates.name || !updates.abbreviation) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Name and Abbreviation both needed."
      );
    }
    const roleDoc = await this.findOne({
      role_id: roleId,
      is_active: true,
    });
    if (!roleDoc) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Invalid roleId");
    }
    roleDoc.name = updates.name;
    roleDoc.abbreviation = updates.abbreviation;
    await roleDoc.save();
    return roleDoc;
  } catch (error) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

roleSchema.statics.toggleIsActiveById = async function (
  roleId: string
): Promise<string> {
  try {
    const role = await this.findOne({ role_id: roleId, is_active: true });
    if (!role) {
      throw new ApiError(httpStatus.NOT_FOUND, "Role not found");
    }
    role.is_active = !role.is_active;
    await role.save();
    return `Role is now ${role.is_active ? "active" : "inactive"}`;
  } catch (error) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message || "Error toggling role status"
    );
  }
};

export const Role: IRoleModel = mongoose.model<IRole, IRoleModel>(
  "Role",
  roleSchema
);
