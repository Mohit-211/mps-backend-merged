/** @format */
import mongoose from "mongoose";
import httpStatus from "http-status";
import { ApiError } from "../../utils";
import { Client, IUser, User } from "../../models";
import {
	BodyDefinition,
	ParamsDefinition,
	QueryDefinition,
} from '../../types/RouteDefinition';
import { userStatusTypes } from "../../configs/constantTypes";

export const getAllAgencies = async () => {
  try {
    const agencies = await User.aggregate([
      {
        $match: { user_type: "AGENCY" }, 
      },
      {
        $lookup: {
          from: "profiles", 
          localField: "_id", 
          foreignField: "user_id", 
          as: "profile", 
        },
      },
      {
        $unwind: {
          path: "$profile",
          preserveNullAndEmptyArrays: true, 
        },
      },
      {
        $project: {
          password: 0, 
        },
      },
    ]);

    return agencies;
  } catch (error) {
    throw new ApiError(
      error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

export const getAgencyById = async (params: ParamsDefinition): Promise<IUser | null> => {
  try {
    const { id } = params;
      console.log("Agency ID param:", id);

    // Validate before converting
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Invalid agency ID format");
    }

 const objectId = new mongoose.Types.ObjectId(id);
    const agency = await User.aggregate([
      {
        $match: {
          _id: objectId,
          user_type: "AGENCY",
        },
      },
      {
        $lookup: {
          from: "profiles",
          localField: "_id",
          foreignField: "user_id",
          as: "user_profile",
        },
      },
      {
        $unwind: {
          path: "$user_profile",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          password: 0,
        },
      },
    ]);

    if (!agency || agency.length === 0) {
      throw new ApiError(httpStatus.NOT_FOUND, "Agency not found");
    }

    return agency[0] as IUser;
  } catch (error: any) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

export const updateAgencyStatus = async (params: {
  id: string;
  status: string;
}) => {
  try {
    const { id, status } = params;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Invalid agency ID format");
    }

    // Validate status
    if (![userStatusTypes.ACCEPTED, userStatusTypes.REJECTED].includes(status)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Invalid status. Allowed values are ACCEPTED or REJECTED."
      );
    }
    const updatedAgency = await User.findOneAndUpdate(
      { _id: id, user_type: "AGENCY" },
      { $set: { status } },
      { new: true, projection: { password: 0 } }
    );

    if (!updatedAgency) {
      throw new ApiError(httpStatus.NOT_FOUND, "Agency not found");
    }

    return updatedAgency;
  } catch (error: any) {
    throw new ApiError(
      error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

export const getAllBusinesses = async () => {
  try {
    const businesses = await User.aggregate([
      { $match: { user_type: "BUSINESS" } },
      {
        $lookup: {
          from: "profiles",
          localField: "_id",
          foreignField: "user_id",
          as: "profile",
        },
      },
      {
        $unwind: {
          path: "$profile",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          password: 0,
        },
      },
    ]);

    return businesses;
  } catch (error) {
    throw new ApiError(
      error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

export const getBusinessesById = async (params: ParamsDefinition): Promise<IUser | null> => {
  try {
    const { id } = params;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Invalid agency ID format");
    }

 const objectId = new mongoose.Types.ObjectId(id);
    const agency = await User.aggregate([
      {
        $match: {
          _id: objectId,
          user_type: "BUSINESS",
        },
      },
      {
        $lookup: {
          from: "profiles",
          localField: "_id",
          foreignField: "user_id",
          as: "user_profile",
        },
      },
      {
        $unwind: {
          path: "$user_profile",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          password: 0,
        },
      },
    ]);

    if (!agency || agency.length === 0) {
      throw new ApiError(httpStatus.NOT_FOUND, "Agency not found");
    }

    return agency[0] as IUser;
  } catch (error: any) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

export const getAllClients = async () => {
  try {
    const clients = await Client.aggregate([
      {
        $lookup: {
          from: "users",
          localField: "created_by", 
          foreignField: "_id", 
          as: "created_by_user",
        },
      },
      {
        $unwind: {
          path: "$created_by_user",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $lookup: {
          from: "profiles", 
          localField: "created_by_user._id",
          foreignField: "user_id",
          as: "created_by_user.profile",
        },
      },
      {
        $unwind: {
          path: "$created_by_user.profile",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          password: 0,
          "created_by_user.password": 0,
          "created_by_user.resetToken": 0,
          "created_by_user.__v": 0,
        },
      },
    ]);

    return clients;
  } catch (error) {
    throw new ApiError(
      error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};




